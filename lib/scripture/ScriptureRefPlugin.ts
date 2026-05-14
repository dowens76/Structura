/**
 * TipTap extension that decorates scripture references in notes with a
 * dotted underline, using ProseMirror Decorations (same pattern as
 * SearchHighlightExtension in NoteEditor.tsx).
 *
 * The stored TipTap JSON is never modified — decorations are computed on
 * the fly from the document text.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { parseScriptureRefs } from "./reference-parser";

export const ScriptureRefKey = new PluginKey<DecorationSet>("scriptureRef");

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const matches = parseScriptureRefs(node.text);
    for (const m of matches) {
      decorations.push(
        Decoration.inline(pos + m.from, pos + m.to, {
          class: "scripture-ref",
          "data-scripture-ref": m.osisRef,
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const ScriptureRefPlugin = Extension.create({
  name: "scriptureRef",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ScriptureRefKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, old) {
            return tr.docChanged
              ? buildDecorations(tr.doc)
              : old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return ScriptureRefKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
