/**
 * CodeMirror Editor Setup
 * 
 * Creates and configures the CodeMirror 6 editor with Luau language support.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import type { Extension, StateEffect } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { acceptCompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

import { luauTextMate, initLuauTextMate } from './textmate';
export { initLuauTextMate };
import { darkTheme, lightTheme } from './themes';
import { luauLspExtensions } from './lspExtensions';
import { luauEnterKeymap, luauIndentation } from './luauBlocks';
import { forceLinting, lintGutter } from '@codemirror/lint';
import { EDITOR_FONT_SIZE, EDITOR_LINE_HEIGHT, EDITOR_PADDING_Y } from './metrics';
import { themeMode } from '$lib/utils/theme';
import { cursorLine, isRunning } from '$lib/stores/playground';
import { keybindings, type KeybindingMode } from '$lib/stores/settings';
import { runCode, stopExecution } from '$lib/luau/wasm';
import { get } from 'svelte/store';

let editorView: EditorView | null = null;
let onChangeCallback: ((content: string) => void) | null = null;

// Track a separate EditorState per file so history is file-specific
const fileStates = new Map<string, EditorState>();
let currentFile: string | null = null;

// Compartments for dynamic reconfiguration
const themeCompartment = new Compartment();
const keybindingsCompartment = new Compartment();

// Subscribe to theme and keybinding changes
let unsubscribeTheme: (() => void) | null = null;
let unsubscribeKeybindings: (() => void) | null = null;

function getThemeExtension(): Extension {
  const mode = get(themeMode);
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return isDark ? darkTheme : lightTheme;
}

// Alternate keymaps are loaded on demand so their bundles are only fetched when selected
const keybindingLoaders: Record<Exclude<KeybindingMode, 'default'>, () => Promise<Extension>> = {
  vim: async () => (await import('@replit/codemirror-vim')).vim(),
};
const loadedKeybindings = new Map<KeybindingMode, Extension>();

function getKeybindingsExtension(): Extension {
  return loadedKeybindings.get(get(keybindings)) ?? [];
}

async function loadKeybindings(mode: KeybindingMode): Promise<void> {
  if (mode === 'default' || loadedKeybindings.has(mode)) return;
  loadedKeybindings.set(mode, await keybindingLoaders[mode]());
}

/**
 * Apply a reconfiguration to the active view and every cached file state,
 * so switching files doesn't bring back a stale configuration.
 */
function reconfigureAll(effects: StateEffect<unknown>): void {
  editorView?.dispatch({ effects });
  for (const [name, state] of fileStates) {
    if (name !== currentFile) {
      fileStates.set(name, state.update({ effects }).state);
    }
  }
}

/**
 * Create base extensions for the editor.
 */
function createExtensions(onChange: (content: string) => void): Extension[] {
  return [
    // Alternate keybindings (dynamic), must precede other keymaps
    keybindingsCompartment.of(getKeybindingsExtension()),

    // Basic setup
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of('    '),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    lintGutter(),
    
    // Keymaps
    keymap.of([
      ...luauEnterKeymap,
      ...closeBracketsKeymap,
      { key: 'Mod-Enter', run: () => { get(isRunning) ? stopExecution() : runCode(); return true; } },
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      { key: 'Tab', run: acceptCompletion },
      indentWithTab,
    ]),
    
    // Luau language + LSP extensions
    luauTextMate(),
    luauIndentation(),
    ...luauLspExtensions(),
    
    // Theme (dynamic)
    themeCompartment.of(getThemeExtension()),
    
    // Accessibility
    EditorView.contentAttributes.of({ 'aria-label': 'Luau code editor' }),
    
    // Base styling
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: `${EDITOR_FONT_SIZE}px`,
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: String(EDITOR_LINE_HEIGHT),
        overflow: 'auto',
      },
      '.cm-content': {
        padding: `${EDITOR_PADDING_Y}px 0`,
      },
      '.cm-vim-panel': {
        fontFamily: 'var(--font-mono)',
      },
      '.cm-vim-panel input': {
        color: 'inherit',
        fontFamily: 'inherit',
      },
    }),
    
    // Update listener
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        onChange(update.state.doc.toString());
      }
      
      // Track cursor line changes for bytecode highlighting
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos).number;
        cursorLine.set(line);
      }
    }),
  ];
}

/**
 * Create the editor instance.
 */
export function createEditor(
  container: HTMLElement,
  initialContent: string,
  onChange: (content: string) => void
): EditorView {
  onChangeCallback = onChange;

  const state = EditorState.create({
    doc: initialContent,
    extensions: createExtensions(onChange),
  });

  editorView = new EditorView({
    state,
    parent: container,
  });

  // Subscribe to theme changes
  unsubscribeTheme = themeMode.subscribe(() => {
    reconfigureAll(themeCompartment.reconfigure(getThemeExtension()));
  });

  // Subscribe to keybinding changes
  unsubscribeKeybindings = keybindings.subscribe(async (mode) => {
    await loadKeybindings(mode);
    // Skip if the selection changed while loading
    if (get(keybindings) !== mode) return;
    reconfigureAll(keybindingsCompartment.reconfigure(getKeybindingsExtension()));
  });

  // Also listen for system theme changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleMediaChange = () => {
    if (get(themeMode) === 'system') {
      reconfigureAll(themeCompartment.reconfigure(getThemeExtension()));
    }
  };
  mediaQuery.addEventListener('change', handleMediaChange);

  return editorView;
}

/**
 * Destroy the editor instance.
 */
export function destroyEditor(): void {
  if (unsubscribeTheme) {
    unsubscribeTheme();
    unsubscribeTheme = null;
  }
  if (unsubscribeKeybindings) {
    unsubscribeKeybindings();
    unsubscribeKeybindings = null;
  }
  
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
  onChangeCallback = null;
  fileStates.clear();
  currentFile = null;
}

/**
 * Update the editor content.
 */
export function updateEditorContent(content: string): void {
  if (editorView) {
    const currentContent = editorView.state.doc.toString();
    if (currentContent !== content) {
      editorView.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }
}

/**
 * Switch the active file by swapping the entire EditorState.
 * Maintains an independent undo history per file.
 */
export function switchFile(fileName: string, content: string): void {
  if (!editorView) return;

  // Persist the current view state for the previously active file
  if (currentFile) {
    fileStates.set(currentFile, editorView.state);
  }

  let nextState = fileStates.get(fileName);

  if (!nextState) {
    // Create a fresh state for this file with its own history
    nextState = EditorState.create({
      doc: content,
      extensions: createExtensions(onChangeCallback || (() => {})),
    });
    fileStates.set(fileName, nextState);
  }

  // Swap the entire state (brings along its own history stack)
  editorView.setState(nextState);
  currentFile = fileName;
}

/**
 * Get the current editor content.
 */
export function getEditorContent(): string {
  return editorView?.state.doc.toString() || '';
}

/**
 * Get the editor view instance.
 */
export function getEditorView(): EditorView | null {
  return editorView;
}

/**
 * Focus the editor.
 */
export function focusEditor(): void {
  editorView?.focus();
}

/**
 * Force a refresh of diagnostics.
 * This is useful when settings change and we need to re-run the linter.
 */
export function refreshDiagnostics(): void {
  if (editorView) {
    forceLinting(editorView);
  }
}
