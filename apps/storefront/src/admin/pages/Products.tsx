import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { adminApi, formatMoney } from "../api.js";
import type { AdminCategory, AdminProduct, AdminProductImage, ProductInput } from "../types.js";
import { Panel } from "../App.js";

/**
 * Form state, kept separate from ProductInput: numeric and money fields are held
 * as strings so a half-typed value is never coerced to NaN, and so price stays in
 * the major-unit form the API expects ("249.00").
 */
interface Draft {
  name: string;
  slug: string;
  categoryId: string;
  sku: string;
  unitLabel: string;
  price: string;
  compareAtPrice: string;
  lowStockThreshold: string;
  initialStock: string;
  shortDescription: string;
  description: string;
  isActive: boolean;
  isFeatured: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  slug: "",
  categoryId: "",
  sku: "",
  unitLabel: "unit",
  price: "",
  compareAtPrice: "",
  lowStockThreshold: "5",
  initialStock: "0",
  shortDescription: "",
  description: "",
  isActive: true,
  isFeatured: false,
};

/** Flatten a category tree into picker options with an indented label. */
function categoryChoices(nodes: AdminCategory[]): Array<{ id: number; label: string }> {
  const rows: Array<{ id: number; label: string }> = [];
  const walk = (list: AdminCategory[], depth: number) => {
    for (const node of list) {
      rows.push({ id: node.id, label: `${"— ".repeat(depth)}${node.name}` });
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}

/**
 * Units a product is sold in. Free text let the field drift between "kg", "Kg"
 * and "kgs", which then showed up inconsistently across the storefront.
 */
const UNIT_OPTIONS = [
  "unit",
  "kg",
  "g",
  "litre",
  "ml",
  "pack",
  "piece",
  "dozen",
  "box",
  "tray",
  "bundle",
  "bunch",
];

/** Short random tail so an auto-SKU is unique even for two products of the same name. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
}

/** Derive a SKU from the product name, e.g. "Basmati Rice" -> "BASMATI-RICE-4F2A". */
function buildSku(name: string, suffix: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/g, "");
  return `${base || "SKU"}-${suffix}`;
}

export default function Products() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState<number | null>(null);

  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [images, setImages] = useState<AdminProductImage[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // While true the SKU tracks the name; a manual edit flips it off so an
  // operator's own SKU is never overwritten by a later name change.
  const [skuAuto, setSkuAuto] = useState(true);
  const [skuSuffix, setSkuSuffix] = useState("0000");

  const load = useCallback(async () => {
    try {
      const page = await adminApi.products({ pageSize: "100" });
      setProducts(page.items);
      setTotal(page.meta.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load products");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setCategories(await adminApi.categories({ includeInactive: "true" }));
      } catch {
        // A missing category list just disables the picker; the banner from a
        // failed product load is more useful than a second error here.
      }
    })();
  }, []);

  const choices = categoryChoices(categories);

  /**
   * Optimistic toggle, reverted from the server response on failure. The list is
   * refetched rather than patched locally so the quantities shown always come
   * from the ledger-backed truth.
   */
  const toggle = async (product: AdminProduct, field: "active" | "featured") => {
    setBusyId(product.id);
    try {
      if (field === "active") await adminApi.setProductActive(product.id, !product.isActive);
      else await adminApi.setProductFeatured(product.id, !product.isFeatured);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const adjust = async (product: AdminProduct, change: number) => {
    setBusyId(product.id);
    try {
      await adminApi.adjustStock({
        productId: product.id,
        quantityChange: change,
        type: "ADJUSTMENT",
        referenceType: "MANUAL",
      });
      setAdjusting(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stock adjustment failed");
    } finally {
      setBusyId(null);
    }
  };

  const startCreate = () => {
    const suffix = randomSuffix();
    setEditingId(null);
    setSkuSuffix(suffix);
    setSkuAuto(true);
    setDraft({ ...EMPTY_DRAFT, sku: buildSku("", suffix) });
    setImages([]);
    setImageFile(null);
    setError(null);
  };

  const startEdit = (product: AdminProduct) => {
    setEditingId(product.id);
    setSkuAuto(false);
    setDraft({
      name: product.name,
      slug: product.slug,
      categoryId: String(product.categoryId ?? product.category?.id ?? ""),
      sku: product.sku,
      unitLabel: product.unitLabel,
      price: (product.price / 100).toFixed(2),
      compareAtPrice: product.compareAtPrice !== null ? (product.compareAtPrice / 100).toFixed(2) : "",
      lowStockThreshold: String(product.lowStockThreshold),
      initialStock: "0",
      shortDescription: product.shortDescription ?? "",
      description: product.description ?? "",
      isActive: product.isActive,
      isFeatured: product.isFeatured,
    });
    setImages(product.images ?? []);
    setImageFile(null);
    setError(null);
  };

  const closeForm = () => {
    setDraft(null);
    setEditingId(null);
    setImages([]);
    setImageFile(null);
    setSkuAuto(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;

    const payload: ProductInput = {
      name: draft.name.trim(),
      slug: draft.slug.trim() || undefined,
      categoryId: Number(draft.categoryId),
      sku: draft.sku.trim(),
      unitLabel: draft.unitLabel.trim() || "unit",
      price: draft.price.trim(),
      compareAtPrice: draft.compareAtPrice.trim(),
      lowStockThreshold: Number(draft.lowStockThreshold),
      shortDescription: draft.shortDescription,
      description: draft.description,
      isActive: draft.isActive,
      isFeatured: draft.isFeatured,
    };

    setBusy(true);
    setError(null);
    try {
      if (editingId === null) {
        const created = await adminApi.createProduct({ ...payload, initialStock: Number(draft.initialStock) });
        // The image route needs a product id, so the upload follows the create.
        if (imageFile) await adminApi.uploadProductImage(created.id, imageFile);
      } else {
        await adminApi.updateProduct(editingId, payload);
        if (imageFile) await adminApi.uploadProductImage(editingId, imageFile);
      }
      closeForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the product");
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async (imageId: number) => {
    if (!window.confirm("Remove this image from the product?")) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteProductImage(imageId);
      setImages((current) => current.filter((image) => image.id !== imageId));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the image");
    } finally {
      setBusy(false);
    }
  };

  const visible = products.filter((product) =>
    query ? `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase()) : true,
  );

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={query}
          placeholder="Filter by name or SKU"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter products"
        />
        <button type="button" className="button" onClick={startCreate} disabled={draft !== null && editingId === null}>
          Add product
        </button>
        <span className="hint">
          {visible.length} shown · {total} total
        </span>
      </div>

      {error ? <p className="banner">{error}</p> : null}

      {draft ? (
        <Panel title={editingId === null ? "Add product" : "Edit product"}>
          <form className="form" onSubmit={save}>
            <label>
              <span>Name</span>
              <input
                value={draft.name}
                required
                minLength={2}
                maxLength={200}
                onChange={(event) => {
                  const name = event.target.value;
                  setDraft((current) =>
                    current
                      ? { ...current, name, ...(skuAuto ? { sku: buildSku(name, skuSuffix) } : {}) }
                      : current,
                  );
                }}
              />
            </label>

            <label>
              <span>SKU</span>
              <input
                value={draft.sku}
                required
                minLength={2}
                maxLength={64}
                onChange={(event) => {
                  setSkuAuto(false);
                  setDraft({ ...draft, sku: event.target.value });
                }}
              />
              {editingId === null ? (
                <span className="hint">
                  Generated from the name.{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      const suffix = randomSuffix();
                      setSkuSuffix(suffix);
                      setSkuAuto(true);
                      setDraft({ ...draft, sku: buildSku(draft.name, suffix) });
                    }}
                  >
                    Regenerate
                  </button>
                </span>
              ) : null}
            </label>

            <label>
              <span>Category</span>
              <select
                value={draft.categoryId}
                required
                onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
              >
                <option value="" disabled>
                  Select a category
                </option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
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
              <span>Unit label</span>
              <select
                value={draft.unitLabel}
                onChange={(event) => setDraft({ ...draft, unitLabel: event.target.value })}
              >
                {/* Keep a value that predates the dropdown (e.g. "1 L") selectable,
                    so editing other fields does not silently rewrite the unit. */}
                {!UNIT_OPTIONS.includes(draft.unitLabel) ? (
                  <option value={draft.unitLabel}>{draft.unitLabel} (current)</option>
                ) : null}
                {UNIT_OPTIONS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Price</span>
              <input
                value={draft.price}
                required
                inputMode="decimal"
                placeholder="249.00"
                onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              />
            </label>

            <label>
              <span>Compare-at price</span>
              <input
                value={draft.compareAtPrice}
                inputMode="decimal"
                placeholder="Optional, must exceed the price"
                onChange={(event) => setDraft({ ...draft, compareAtPrice: event.target.value })}
              />
            </label>

            <label>
              <span>Low stock threshold</span>
              <input
                type="number"
                min={0}
                value={draft.lowStockThreshold}
                onChange={(event) => setDraft({ ...draft, lowStockThreshold: event.target.value })}
              />
            </label>

            {editingId === null ? (
              <label>
                <span>Opening stock</span>
                <input
                  type="number"
                  min={0}
                  value={draft.initialStock}
                  onChange={(event) => setDraft({ ...draft, initialStock: event.target.value })}
                />
              </label>
            ) : null}

            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              />
              <span>Visible in the storefront</span>
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.isFeatured}
                onChange={(event) => setDraft({ ...draft, isFeatured: event.target.checked })}
              />
              <span>Featured</span>
            </label>

            <label className="wide">
              <span>Short description</span>
              <input
                value={draft.shortDescription}
                maxLength={300}
                onChange={(event) => setDraft({ ...draft, shortDescription: event.target.value })}
              />
            </label>

            <label className="wide">
              <span>Description</span>
              <textarea
                rows={4}
                maxLength={20000}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>

            <label className="wide">
              <span>Product image</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
              />
            </label>

            {editingId !== null && images.length > 0 ? (
              <div className="wide image-list">
                {images.map((image) => (
                  <div key={image.id} className="image-row">
                    <img src={image.url} alt={image.altText || draft.name} />
                    {image.isPrimary ? <span className="pill pill-confirmed">Primary</span> : null}
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={busy}
                      onClick={() => void removeImage(image.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="form-actions wide">
              <button type="submit" className="button" disabled={busy}>
                {busy ? "Saving…" : editingId === null ? "Create product" : "Save changes"}
              </button>
              <button type="button" className="link-button" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel title="Products">
        <table>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">SKU</th>
              <th scope="col">Price</th>
              <th scope="col">Stock</th>
              <th scope="col">Active</th>
              <th scope="col">Featured</th>
              <th scope="col">Stock adjust</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const low = product.stockQuantity <= product.lowStockThreshold;
              const thumbnail = product.images?.[0];
              return (
                <tr key={product.id} className={editingId === product.id ? "editing" : undefined}>
                  <td>
                    <span className="product-cell">
                      {thumbnail ? <img className="thumb" src={thumbnail.url} alt="" /> : null}
                      <span>
                        {product.name}
                        <span className="muted"> {product.category?.name ?? "Uncategorised"}</span>
                      </span>
                    </span>
                  </td>
                  <td className="mono">{product.sku}</td>
                  <td>{formatMoney(product.price)}</td>
                  <td className={low ? "low" : undefined}>
                    {product.stockQuantity} {product.unitLabel}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={product.isActive ? "toggle on" : "toggle"}
                      disabled={busyId === product.id}
                      onClick={() => void toggle(product, "active")}
                    >
                      {product.isActive ? "Yes" : "No"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={product.isFeatured ? "toggle on" : "toggle"}
                      disabled={busyId === product.id}
                      onClick={() => void toggle(product, "featured")}
                    >
                      {product.isFeatured ? "Yes" : "No"}
                    </button>
                  </td>
                  <td>
                    {adjusting === product.id ? (
                      <span className="adjust">
                        <button type="button" disabled={busyId === product.id} onClick={() => void adjust(product, -1)}>
                          −1
                        </button>
                        <button type="button" disabled={busyId === product.id} onClick={() => void adjust(product, 1)}>
                          +1
                        </button>
                        <button type="button" onClick={() => setAdjusting(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="link-button" onClick={() => setAdjusting(product.id)}>
                        Adjust
                      </button>
                    )}
                  </td>
                  <td className="actions">
                    <button type="button" className="link-button" onClick={() => startEdit(product)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? <p className="empty">No products match that filter.</p> : null}
      </Panel>
    </>
  );
}