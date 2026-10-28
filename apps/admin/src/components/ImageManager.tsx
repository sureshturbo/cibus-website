import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { adminApi } from "../api.js";
import type { AdminProductImage } from "../types.js";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_IMAGES = 12;

/** Move one entry to a new index without mutating the source array. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not update the images";
}

interface ImageManagerProps {
  open: boolean;
  /** Null while creating: files are staged locally until the product exists. */
  productId: number | null;
  productName: string;
  images: AdminProductImage[];
  staged: File[];
  onClose: () => void;
  onImagesChange: (images: AdminProductImage[]) => void;
  onStagedChange: (files: File[]) => void;
  onError: (message: string) => void;
}

/**
 * Popup image manager shared by the create and edit flows.
 *
 * Edit mode talks to the API immediately: uploads, removals and reordering are
 * persisted as they happen (the first image is the cover, by server contract).
 * Create mode cannot upload yet because the images route needs a product id, so
 * files are staged in the parent and uploaded after the product row exists.
 */
export default function ImageManager({
  open,
  productId,
  productName,
  images,
  staged,
  onClose,
  onImagesChange,
  onStagedChange,
  onError,
}: ImageManagerProps) {
  const [mutating, setMutating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => staged.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [staged],
  );

  // Object URLs live until the staged list changes or the popup unmounts.
  useEffect(() => {
    return () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    };
  }, [previews]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const editing = productId !== null;
  const total = editing ? images.length : staged.length;

  const refresh = async () => {
    if (productId === null) return;
    const fresh = await adminApi.product(productId).catch(() => null);
    if (fresh) onImagesChange(fresh.images);
  };

  const addFiles = async (files: File[]) => {
    const accepted = files.filter((file) => ACCEPTED_TYPES.includes(file.type));
    if (accepted.length !== files.length) {
      onError("Only JPEG, PNG, WebP or AVIF images can be uploaded.");
    }
    if (accepted.length === 0) return;

    const room = MAX_IMAGES - total;
    if (room <= 0) {
      onError(`A product can have at most ${MAX_IMAGES} images.`);
      return;
    }
    const batch = accepted.slice(0, room);

    if (!editing) {
      onStagedChange([...staged, ...batch]);
      return;
    }

    setMutating(true);
    try {
      const uploaded: AdminProductImage[] = [];
      for (const file of batch) {
        uploaded.push(await adminApi.uploadProductImage(productId, file, productName));
      }
      // Uploads all land at sort order 0, so persist the intended order; the
      // server makes the first entry primary.
      const ordered = [...images, ...uploaded];
      await adminApi.reorderProductImages(productId, ordered.map((image) => image.id));
      await refresh();
    } catch (error) {
      onError(errorMessage(error));
      await refresh();
    } finally {
      setMutating(false);
    }
  };

  const reorder = async (from: number, to: number) => {
    if (editing) {
      const next = moveItem(images, from, to).map((image, index) => ({
        ...image,
        isPrimary: index === 0,
        sortOrder: index,
      }));
      if (next === images) return;
      onImagesChange(next);
      setMutating(true);
      try {
        await adminApi.reorderProductImages(productId, next.map((image) => image.id));
      } catch (error) {
        onError(errorMessage(error));
        await refresh();
      } finally {
        setMutating(false);
      }
      return;
    }
    onStagedChange(moveItem(staged, from, to));
  };

  const remove = async (index: number) => {
    if (!editing) {
      onStagedChange(staged.filter((_, position) => position !== index));
      return;
    }
    const image = images[index];
    if (!image) return;
    if (!window.confirm("Remove this image from the product?")) return;

    setMutating(true);
    try {
      await adminApi.deleteProductImage(image.id);
      await refresh();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setMutating(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const tile = (url: string, index: number) => (
    <div className="image-tile" key={`${url}-${index}`}>
      <img src={url} alt="" />
      {index === 0 ? <span className="image-tile__badge">Cover</span> : null}
      <div className="image-tile__actions">
        <button
          type="button"
          className="link-button"
          disabled={mutating || index === 0}
          onClick={() => void reorder(index, index - 1)}
        >
          Left
        </button>
        <button
          type="button"
          className="link-button"
          disabled={mutating || index === total - 1}
          onClick={() => void reorder(index, index + 1)}
        >
          Right
        </button>
        {index > 0 ? (
          <button
            type="button"
            className="link-button"
            disabled={mutating}
            onClick={() => void reorder(index, 0)}
          >
            Make cover
          </button>
        ) : null}
        <button
          type="button"
          className="link-button danger"
          disabled={mutating}
          onClick={() => void remove(index)}
        >
          Remove
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="image-manager-title">
        <div className="modal-head">
          <div>
            <h2 id="image-manager-title">Product images</h2>
            <p className="hint">
              {editing
                ? "Changes save as you make them."
                : "Images upload when you create the product."}
            </p>
          </div>
          <button type="button" className="modal-close" aria-label="Close image manager" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body">
          <label
            className={dragging ? "dropzone dropzone--over" : "dropzone"}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              hidden
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <strong>{dragging ? "Drop to add" : "Drop images here"}</strong>
            <span className="hint">or click to choose - JPEG, PNG, WebP or AVIF, up to {MAX_IMAGES} images</span>
          </label>

          {mutating ? <p className="hint" role="status">Saving images...</p> : null}

          {total === 0 ? (
            <p className="empty">No images yet. The first image becomes the storefront cover.</p>
          ) : (
            <div className="image-grid">
              {editing
                ? images.map((image, index) => tile(image.url, index))
                : previews.map((preview, index) => tile(preview.url, index))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="hint">The first image is the cover shown on cards and search.</span>
          <button type="button" className="button" onClick={onClose} disabled={mutating}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
