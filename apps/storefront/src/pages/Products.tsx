import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.js";
import { ProductCard } from "../components/ProductCard.js";
import PageHero from "../components/layout/PageHero.js";
import Sheet from "../components/ui/Sheet.js";
import { api } from "../api.js";
import { useUi } from "../context/UiContext.js";
import { useCart } from "../context/CartContext.js";
import { useToast } from "../components/ui/Toast.js";
import { SHOP_ENABLED } from "../config.js";
import type { PageMeta, Product } from "../types.js";

const SORT_OPTIONS = [
  { value: "name_asc", label: "Name: A to Z" },
  { value: "newest", label: "Newest first" },
  { value: "name_desc", label: "Name: Z to A" },
  ...(SHOP_ENABLED
    ? [
        { value: "price_asc", label: "Price: low to high" },
        { value: "price_desc", label: "Price: high to low" },
      ]
    : []),
];

const PAGE_SIZE = 12;
const DEFAULT_SORT = "name_asc";

type View = "2" | "3" | "4";

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="filter-section">
      <button
        type="button"
        className="filter-section__head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {title}
        <Icon name="chevronDown" size={18} />
      </button>
      {open ? <div className="filter-options">{children}</div> : null}
    </div>
  );
}

export default function Products() {
  const [params, setParams] = useSearchParams();
  const { categories, sheet, open, close } = useUi();
  const { add } = useCart();
  const toast = useToast();

  const category = params.get("category") ?? "";
  const search = params.get("search") ?? "";
  const sort = params.get("sort") ?? DEFAULT_SORT;
  const inStock = params.get("inStock") ?? "";

  const [view, setView] = useState<View>("4");
  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);

  const activeCategory = categories.find((entry) => entry.slug === category);

  /**
   * Filtering is server-side, so the URL is the single source of truth for what
   * is being viewed. That makes a filtered view shareable and survives a
   * refresh without any extra state syncing.
   */
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  /* Each request gets a number so a slow response for an old filter cannot
     overwrite the results of a newer one. */
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (targetPage: number, append: boolean) => {
      const request = ++requestRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        const result = await api.products({
          page: targetPage,
          pageSize: PAGE_SIZE,
          sort,
          ...(category ? { category } : {}),
          ...(search ? { search } : {}),
          ...(inStock ? { inStock } : {}),
        });

        if (request !== requestRef.current) return;
        setMeta(result.meta);
        setPage(targetPage);
        setItems((current) => (append ? [...current, ...result.items] : result.items));
      } catch {
        if (request !== requestRef.current) return;
        if (!append) setItems([]);
        toast.push("We could not load these products.", "error");
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [category, search, sort, inStock, toast],
  );

  // A filter change rebuilds `load`, which restarts the list from page one.
  useEffect(() => {
    void load(1, false);
  }, [load]);

  const hasMore = meta !== null && page < meta.totalPages;
  const loadNextRef = useRef<() => void>(() => {});
  loadNextRef.current = () => {
    if (loading || loadingMore || !hasMore) return;
    void load(page + 1, true);
  };

  /* Infinite scroll: fetch the next page while the end of the grid is still
     a screen away, so products are usually there before the shopper arrives. */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, items.length > 0]);

  // If the first page is too short to reach the sentinel, keep filling.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || loadingMore || !hasMore) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 600) loadNextRef.current();
  }, [items.length, loading, loadingMore, hasMore]);

  const quickAdd = async (productId: number) => {
    setAdding(productId);
    try {
      await add(productId, 1);
      toast.push(
        <>
          Added to your cart.{" "}
          <Link to="/cart">View cart</Link>
        </>,
      );
    } catch {
      toast.push("That item could not be added. Please try again.", "error");
    } finally {
      setAdding(null);
    }
  };

  const chips = useMemo(() => {
    const list: { label: string; clear: () => void }[] = [];
    if (activeCategory) list.push({ label: activeCategory.name, clear: () => setParam("category", "") });
    if (search) list.push({ label: `“${search}”`, clear: () => setParam("search", "") });
    if (inStock === "true") list.push({ label: "In stock", clear: () => setParam("inStock", "") });
    return list;
  }, [activeCategory, search, inStock]);

  const filterPanel = (
    <>
      <FilterSection title="Categories">
        <label className="filter-option">
          <input
            type="radio"
            name="category"
            checked={!category}
            onChange={() => setParam("category", "")}
          />
          <span>All products</span>
        </label>
        {categories.map((entry) => (
          <label key={entry.id} className="filter-option">
            <input
              type="radio"
              name="category"
              checked={category === entry.slug}
              onChange={() => setParam("category", entry.slug)}
            />
            <span>{entry.name}</span>
            <em className="filter-count">{entry.productCount}</em>
          </label>
        ))}
      </FilterSection>

      <FilterSection title="Availability">
        <label className="filter-option">
          <input
            type="checkbox"
            checked={inStock === "true"}
            onChange={(event) => setParam("inStock", event.target.checked ? "true" : "")}
          />
          <span>In stock only</span>
        </label>
      </FilterSection>

      {chips.length > 0 ? (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => {
            const next = new URLSearchParams();
            if (sort !== DEFAULT_SORT) next.set("sort", sort);
            setParams(next, { replace: true });
          }}
        >
          Clear all filters
        </button>
      ) : null}

      <button type="button" className="btn btn--block" onClick={close}>
        Show {meta?.total ?? items.length} result{meta?.total === 1 ? "" : "s"}
      </button>
    </>
  );

  const title = search ? `Results for “${search}”` : (activeCategory?.name ?? "All products");

  return (
    <>
      <PageHero
        slug="products"
        title={title}
        subtitle={activeCategory || search ? "Food Products" : "Our catalogue"}
      />

      <div className="container section">
        {/* Toolbar: filters on the left, view switch in the middle, sort on the right. */}
        <div className="toolbar">
          <button type="button" className="btn btn--ghost btn--sm toolbar__filters" onClick={() => open("filters")}>
            <Icon name="filter" size={17} />
            Filters
          </button>

          <div className="view-switch toolbar__view" role="group" aria-label="Products per row">
            {(["2", "3", "4"] as View[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                aria-label={`${option} per row`}
                onClick={() => setView(option)}
              >
                <Icon name={option === "2" ? "grid2" : option === "3" ? "grid3" : "grid4"} size={17} />
              </button>
            ))}
          </div>

          <div className="toolbar__group">
            <span className="toolbar__count">
              {loading ? (
                "Loading"
              ) : (
                <>
                  <b>{meta?.total ?? 0}</b> product{meta?.total === 1 ? "" : "s"}
                </>
              )}
            </span>

            <label className="sr-only" htmlFor="sort">
              Sort products
            </label>
            <select
              id="sort"
              className="select"
              value={sort}
              onChange={(event) => setParam("sort", event.target.value)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {chips.length > 0 ? (
          <div className="chips">
            {chips.map((chip) => (
              <span key={chip.label} className="chip">
                {chip.label}
                <button type="button" aria-label={`Remove ${chip.label} filter`} onClick={chip.clear}>
                  <Icon name="close" size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="grid-loader" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="skeleton-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={30} />
            </div>
            <h1>Nothing matched</h1>
            <p>Try a different search, or clear the filters to see the whole catalogue.</p>
            <Link to="/products" className="btn">
              Browse all products
            </Link>
          </div>
        ) : (
          <div className="listing-layout">
            <aside className="filters-panel">
              <h2 className="filters-panel__title">Refine</h2>
              {filterPanel}
            </aside>

            <div>
              <div className={`products-grid products-grid--${view}`}>
                {items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    adding={adding === product.id}
                    onAdd={(target) => void quickAdd(target.id)}
                  />
                ))}
              </div>

              {loadingMore ? (
                <div className="grid-loader load-more" aria-busy="true" aria-label="Loading more products">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="skeleton-card" />
                  ))}
                </div>
              ) : null}

              <div ref={sentinelRef} aria-hidden="true" />

              {!hasMore && meta && meta.total > PAGE_SIZE ? (
                <p className="load-more muted">You have seen all {meta.total} products.</p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <Sheet
        open={sheet === "filters"}
        onClose={close}
        title="Filters"
        icon={<Icon name="filter" size={20} />}
        side="left"
      >
        {filterPanel}
      </Sheet>
    </>
  );
}