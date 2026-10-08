import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { adminApi } from "../api.js";
import type { AdminCategory, CategoryInput } from "../types.js";
import { Panel } from "../App.js";

/**
 * Form state, deliberately separate from CategoryInput: sort order is held as a
 * string so a half-typed value does not become NaN, and is converted on submit.
 */
interface Draft {
  name: string;
  slug: string;
  parentId: number | null;
  description: string;
  imageUrl: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  slug: "",
  parentId: null,
  description: "",
  imageUrl: "",
  sortOrder: "0",
  isActive: true,
};

/** A category plus everything below it, so they can be excluded as a parent. */
function collectIds(node: AdminCategory, into: Set<number>): Set<number> {
  into.add(node.id);
  for (const child of node.children ?? []) collectIds(child, into);
  return into;
}

export default function Categories() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // includeInactive so a hidden category is visible here rather than looking
      // like it was deleted.
      setCategories(await adminApi.categories({ includeInactive: "true" }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load categories");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Flattened list for the parent picker. While editing, the category itself and
   * its descendants are omitted: the server rejects a cycle, so offering them
   * would only produce a guaranteed failure.
   */
  const parentChoices = useMemo(() => {
    const excluded = new Set<number>();
    if (editingId !== null) {
      for (const node of categories) {
        if (node.id === editingId) collectIds(node, excluded);
      }
    }

    const rows: Array<{ id: number; label: string }> = [];
    const walk = (nodes: AdminCategory[], depth: number) => {
      for (const node of nodes) {
        if (!excluded.has(node.id)) rows.push({ id: node.id, label: `${"— ".repeat(depth)}${node.name}` });
        if (node.children?.length) walk(node.children, depth + 1);
      }
    };
    walk(categories, 0);
    return rows;
  }, [categories, editingId]);

  const startCreate = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT });
    setError(null);
  };

  const startEdit = (category: AdminCategory) => {
    setEditingId(category.id);
    setDraft({
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      description: category.description ?? "",
      imageUrl: category.imageUrl ?? "",
      sortOrder: String(category.sortOrder),
      isActive: category.isActive,
    });
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;

    const payload: CategoryInput = {
      name: draft.name.trim(),
      slug: draft.slug.trim() || undefined,
      // Sent as an explicit null to move a category to the top level.
      parentId: draft.parentId === null || draft.parentId === undefined ? null : Number(draft.parentId),
      description: draft.description,
      imageUrl: draft.imageUrl,
      sortOrder: Number(draft.sortOrder),
      isActive: draft.isActive,
    };

    setBusy(true);
    setError(null);
    try {
      if (editingId === null) await adminApi.createCategory(payload);
      else await adminApi.updateCategory(editingId, payload);
      setDraft(null);
      setEditingId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the category");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category: AdminCategory) => {
    if (!window.confirm(`Delete "${category.name}"? This cannot be undone.`)) return;

    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteCategory(category.id);
      if (draft && editingId === category.id) {
        setDraft(null);
        setEditingId(null);
      }
      await load();
    } catch (caught) {
      // The server refuses to delete a category that still holds products,
      // subcategories or offers, and explains which one.
      setError(caught instanceof Error ? caught.message : "Could not delete the category");
    } finally {
      setBusy(false);
    }
  };

  const rows: ReactNode[] = [];
  let count = 0;

  const walk = (nodes: AdminCategory[], depth: number) => {
    for (const node of nodes) {
      rows.push(
        <tr key={node.id} className={editingId === node.id ? "editing" : undefined}>
          <td style={{ paddingLeft: `${0.6 + depth * 1.1}rem` }}>
            {depth > 0 ? <span className="muted">↳ </span> : null}
            {node.name}
          </td>
          <td className="mono">{node.slug}</td>
          <td>{node.productCount ?? 0}</td>
          <td>{node.sortOrder}</td>
          <td>
            <span className={node.isActive ? "pill pill-confirmed" : "pill pill-cancelled"}>
              {node.isActive ? "Active" : "Hidden"}
            </span>
          </td>
          <td className="actions">
            <button type="button" className="link-button" onClick={() => startEdit(node)}>
              Edit
            </button>
            <button type="button" className="link-button danger" disabled={busy} onClick={() => void remove(node)}>
              Delete
            </button>
          </td>
        </tr>,
      );
      count += 1;
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };

  walk(categories, 0);

  return (
    <>
      <div className="toolbar">
        <button type="button" className="button" onClick={startCreate} disabled={draft !== null && editingId === null}>
          New category
        </button>
        {draft && editingId !== null ? (
          <button type="button" className="link-button" onClick={() => { setDraft(null); setEditingId(null); }}>
            Cancel edit
          </button>
        ) : null}
        <span className="hint">{count} categories</span>
      </div>

      {error ? <p className="banner">{error}</p> : null}

      {draft ? (
        <Panel title={editingId === null ? "New category" : "Edit category"}>
          <form className="form" onSubmit={save}>
            <label>
              <span>Name</span>
              <input
                value={draft.name}
                required
                minLength={2}
                maxLength={120}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label>
              <span>Slug</span>
              <input
                value={draft.slug}
                maxLength={120}
                placeholder="Derived from the name when left blank"
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
              />
            </label>

            <label>
              <span>Parent</span>
              <select
                value={draft.parentId === null ? "" : String(draft.parentId)}
                onChange={(event) =>
                  setDraft({ ...draft, parentId: event.target.value === "" ? null : Number(event.target.value) })
                }
              >
                <option value="">None (top level)</option>
                {parentChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Sort order</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={draft.sortOrder}
                onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
              />
            </label>

            <label className="wide">
              <span>Description</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>

            <label className="wide">
              <span>Image URL</span>
              <input
                value={draft.imageUrl}
                maxLength={500}
                placeholder="Optional"
                onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
              />
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              />
              <span>Visible in the storefront</span>
            </label>

            <div className="form-actions wide">
              <button type="submit" className="button" disabled={busy}>
                {busy ? "Saving…" : editingId === null ? "Create category" : "Save changes"}
              </button>
              <button type="button" className="link-button" onClick={() => { setDraft(null); setEditingId(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel title="Categories">
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Slug</th>
              <th scope="col">Products</th>
              <th scope="col">Sort order</th>
              <th scope="col">Visibility</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        {count === 0 ? <p className="empty">No categories yet.</p> : null}
      </Panel>
    </>
  );
}