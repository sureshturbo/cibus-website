import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import Icon, { iconFor } from "../components/Icon.js";
import { ProductCard } from "../components/ProductCard.js";
import { api, HERO_BANNERS } from "../api.js";
import { useCart } from "../context/CartContext.js";
import { useUi } from "../context/UiContext.js";
import { useToast } from "../components/ui/Toast.js";
import type { Category, HomePayload, Product } from "../types.js";

/**
 * A zero-priced row is an incomplete catalogue entry. Keep such products out
 * of merchandising rails so a half-finished record cannot become the hero.
 * If everything in the list is unpriced, show it rather than an empty section.
 */
function pricedOnly(products: Product[]): Product[] {
  const priced = products.filter((product) => product.price > 0);
  return priced.length > 0 ? priced : products;
}

/**
 * Auto-scroll speed and the arrow glide. `AUTO_SCROLL_SECONDS` is the time one
 * full copy takes to pass; `GLIDE_MS` is how long an arrow jump animates.
 */
const AUTO_SCROLL_SECONDS = 30;
const GLIDE_MS = 460;

/**
 * Full-bleed banner slider. Every slide is rendered so the cross-fade does not
 * remount the artwork; only the active one is exposed to assistive tech.
 */
function HeroSlider({ payload }: { payload: HomePayload }) {
  const slides = useMemo(() => {
    const { hero } = payload;

    return [
      {
        key: "primary",
        eyebrow: "Cibus Trading",
        image: HERO_BANNERS[0],
        title: (
          <>
            {hero.headline} <em>{hero.highlight}</em>
          </>
        ),
        sub: hero.subheadline,
        primary: { label: hero.primaryCta, to: "/products" },
        secondary: { label: hero.secondaryCta, to: "/page/about" },
        meta: ["Verified suppliers", "Plain pricing", "Every order confirmed"],
      },
      {
        key: "products",
        eyebrow: "Fresh picks",
        image: HERO_BANNERS[1],
        title: (
          <>
            The week&rsquo;s <em>freshest</em> additions
          </>
        ),
        sub: "Produce and pantry lines added as deliveries land, so there is always something new to try.",
        primary: { label: "Shop new arrivals", to: "/products?sort=newest" },
        secondary: { label: "Browse categories", to: "/products" },
        meta: ["Updated weekly", "Quality checked", "Order online"],
      },
      {
        key: "trade",
        eyebrow: "Homes and kitchens",
        image: HERO_BANNERS[2],
        title: (
          <>
            One team keeps your <em>kitchen stocked</em>
          </>
        ),
        sub: "From a single basket to standing trade orders, we supply homes, restaurants and institutions.",
        primary: { label: "Partner with us", to: "/page/about" },
        secondary: { label: "View catalogue", to: "/products" },
        meta: ["Wholesale rates", "Reliable delivery", "Real people"],
      },
      {
        key: "quality",
        eyebrow: "Sourced with care",
        image: HERO_BANNERS[3],
        title: (
          <>
            Everyday essentials you can <em>rely on</em>
          </>
        ),
        sub: "Clear pricing, checked quality and dependable delivery on every order.",
        primary: { label: "Start shopping", to: "/products" },
        secondary: { label: "How we work", to: "/page/what-we-do" },
        meta: ["Honest pricing", "Careful packing", "Friendly support"],
      },
    ];
  }, [payload]);

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [slides.length, paused]);

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Featured highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slides.map((item, index) => {
        const Heading = index === 0 ? "h1" : "h2";
        const isActive = index === active;

        return (
          <div
            key={item.key}
            className={isActive ? "hero__slide hero__slide--active" : "hero__slide"}
            aria-hidden={isActive ? undefined : true}
          >
            <img
              className="hero__bg"
              src={item.image}
              alt=""
              loading={index === 0 ? "eager" : "lazy"}
            />
            <div className="hero__scrim" aria-hidden="true" />
            <div className="container hero__inner">
              <div className="hero__body">
                <span className="hero__eyebrow">{item.eyebrow}</span>
                <Heading className="hero__title">{item.title}</Heading>
                <p className="hero__sub">{item.sub}</p>
                <div className="hero__actions">
                  <Link to={item.primary.to} className="btn btn--lg">
                    {item.primary.label}
                    <Icon name="arrowRight" size={18} />
                  </Link>
                  <Link to={item.secondary.to} className="btn btn--ghost btn--lg">
                    {item.secondary.label}
                  </Link>
                </div>
                <ul className="hero__meta">
                  {item.meta.map((entry) => (
                    <li key={entry}>
                      <Icon name="check" size={16} />
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}

      {slides.length > 1 ? (
        <>
          <div className="hero__dots">
            {slides.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={index === active ? "hero__dot hero__dot--active" : "hero__dot"}
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === active ? "true" : undefined}
                onClick={() => setActive(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className="hero__nav hero__nav--prev"
            aria-label="Previous slide"
            onClick={() => setActive((a) => (a - 1 + slides.length) % slides.length)}
          >
            <Icon name="chevronLeft" size={20} />
          </button>
          <button
            type="button"
            className="hero__nav hero__nav--next"
            aria-label="Next slide"
            onClick={() => setActive((a) => (a + 1) % slides.length)}
          >
            <Icon name="arrowRight" size={20} />
          </button>
        </>
      ) : null}
    </section>
  );
}

interface ProductTab {
  key: string;
  label: string;
  slug?: string;
}

/**
 * Popular products with category tabs. Each tab loads on first use and stays
 * cached for the life of the page so switching back is instant.
 */
function PopularProducts({
  categories,
  adding,
  onAdd,
}: {
  categories: Category[];
  adding: number | null;
  onAdd: (product: Product) => void;
}) {
  const tabs = useMemo<ProductTab[]>(
    () =>
      categories.map((category) => ({
        key: `cat:${category.slug}`,
        label: category.name,
        slug: category.slug,
      })),
    [categories],
  );

  // Categories arrive after the page mounts, so until a tab is picked the
  // first category is the active one.
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? tabs[0]?.key ?? "";
  const [cache, setCache] = useState<Record<string, Product[]>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const activeTab = tabs.find((tab) => tab.key === active) ?? tabs[0];

  useEffect(() => {
    if (!activeTab?.slug) return;
    if (cache[activeTab.key]) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(null);

    void api
      .products({ category: activeTab.slug, pageSize: 8, sort: "newest" })
      .then(({ items }) => {
        if (!cancelled) setCache((current) => ({ ...current, [activeTab.key]: pricedOnly(items) }));
      })
      .catch(() => {
        if (!cancelled) setFailed(activeTab.key);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, cache, attempt]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    setPicked(next.key);
    event.currentTarget
      .closest(".tabs")
      ?.querySelector<HTMLButtonElement>(`[data-tab="${next.key}"]`)
      ?.focus();
  };

  const items = cache[active] ?? [];

  return (
    <section className="section" aria-labelledby="popular-title">
      <div className="container">
        <header className="section__head">
          <div>
            <h2 id="popular-title" className="section__title">
              Popular with our customers
            </h2>
            <p className="lede">Browse our range by category.</p>
          </div>
          <Link to="/products" className="btn btn--ghost">
            View all
            <Icon name="arrowRight" size={17} />
          </Link>
        </header>

        <div className="tabs-bar">
          <div className="tabs" role="tablist" aria-label="Product collections">
            {tabs.map((tab, index) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`tab-${tab.key}`}
                data-tab={tab.key}
                className="tab"
                aria-selected={tab.key === active}
                aria-controls="popular-panel"
                tabIndex={tab.key === active ? 0 : -1}
                onClick={() => setPicked(tab.key)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div
          id="popular-panel"
          role="tabpanel"
          aria-labelledby={`tab-${active}`}
          aria-busy={loading}
          className="tab-panel"
        >
          {failed === active ? (
            <div className="notice notice--danger">
              <Icon name="alert" size={20} />
              <p>We could not load this collection.</p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setFailed(null);
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="grid-loader" aria-busy="true" aria-label="Loading products">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="skeleton-card" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="tab-panel__status">
              Nothing in this collection yet.{" "}
              <Link to="/products">Browse the full catalogue</Link>.
            </p>
          ) : (
            <div className="products-grid">
              {items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  adding={adding === product.id}
                  onAdd={onAdd}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { categories } = useUi();
  const { add } = useCart();
  const toast = useToast();
  const [adding, setAdding] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  /* Where the track is gliding to after an arrow click, and how long since. */
  const glideRef = useRef<{ from: number; to: number; start: number } | null>(null);

  useEffect(() => {
    void api
      .home()
      .then(setPayload)
      .catch(() => setError("We could not load the homepage just now. Please refresh."));
  }, []);

  /**
   * Auto-scroll loop. The card list is rendered twice, so one "copy" is exactly
   * half the track. Wrapping the offset at that distance makes the movement
   * seamless while leaving the offset free for the arrows to move.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let previous = performance.now();
    let paused = false;

    const slider = track.parentElement;
    const onEnter = () => {
      paused = true;
    };
    const onLeave = () => {
      paused = false;
      previous = performance.now();
    };
    slider?.addEventListener("mouseenter", onEnter);
    slider?.addEventListener("mouseleave", onLeave);
    slider?.addEventListener("focusin", onEnter);
    slider?.addEventListener("focusout", onLeave);

    const step = (now: number) => {
      const delta = paused ? 0 : now - previous;
      previous = now;

      const copyWidth = track.scrollWidth / 2;
      if (copyWidth > 0) {
        const glide = glideRef.current;
        if (glide) {
          // Ease the track to the arrow's target instead of snapping, so the
          // products are seen sliding across.
          const progress = Math.min(1, (now - glide.start) / GLIDE_MS);
          const eased = 1 - Math.pow(1 - progress, 3);
          offsetRef.current = glide.from + (glide.to - glide.from) * eased;
          if (progress >= 1) {
            glideRef.current = null;
            // Re-base only after the slide lands, so normalising mid-glide
            // cannot throw the track back across the whole row.
            offsetRef.current = ((offsetRef.current % copyWidth) + copyWidth) % copyWidth;
          }
        } else {
          // Auto-scroll drifts constantly; the arrow only changes the target.
          offsetRef.current -= (copyWidth / AUTO_SCROLL_SECONDS) * (delta / 1000);
          offsetRef.current = ((offsetRef.current % copyWidth) + copyWidth) % copyWidth;
        }

        track.style.transform = `translateX(${offsetRef.current - copyWidth}px)`;
      }

      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frame);
      slider?.removeEventListener("mouseenter", onEnter);
      slider?.removeEventListener("mouseleave", onLeave);
      slider?.removeEventListener("focusin", onEnter);
      slider?.removeEventListener("focusout", onLeave);
    };
  }, [payload]);

  /**
   * Arrow controls for the marquee.
   *
   * The auto-scroll is a requestAnimationFrame loop that owns `offsetRef`, so an
   * arrow only has to change that offset. The loop eases it to the new value
   * over `GLIDE_MS`, which is what makes the products visibly slide across.
   * Driving the position in JS rather than with a CSS animation is deliberate:
   * a running CSS animation wins over an inline transform, which is why writing
   * `style.transform` on the track did nothing.
   */
  const nudge = (direction: 1 | -1) => {
    const track = trackRef.current;
    const first = track?.firstElementChild as HTMLElement | null;
    if (!track || !first) return;
    const step = first.getBoundingClientRect().width + 16;
    const from = offsetRef.current;
    // `from` is already normalised, so easing into a wrapped value would run the
    // slide backwards across the whole track. Keep the target adjacent instead;
    // the loop's modulo re-bases it on the next frame.
    glideRef.current = {
      from,
      to: from - direction * step,
      start: performance.now(),
    };
  };

  const quickAdd = async (product: Product) => {
    setAdding(product.id);
    try {
      await add(product.id, 1);
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

  if (error) {
    return (
      <div className="container section">
        <div className="notice notice--danger">
          <Icon name="alert" size={20} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="container section" aria-busy="true" aria-label="Loading storefront">
        <div className="grid-loader">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  const fresh = pricedOnly(payload.shelfProducts);

  return (
    <>
      <HeroSlider payload={payload} />

      {/* Full-width campaign banners */}
      <section className="promo-band" aria-label="Ways to shop">
        <div className="container">
          <div className="promo-row">
            <div className="promo">
              <span className="promo__eyebrow">Trade accounts</span>
              <h2 className="promo__title">Wholesale rates for kitchens and institutions</h2>
              <p className="promo__sub">
                Consistent stock, clear invoices and one team to call when you need more.
              </p>
              <Link to="/page/about" className="btn">
                Partner with us
                <Icon name="arrowRight" size={17} />
              </Link>
            </div>

            <div className="promo promo--alt">
              <span className="promo__eyebrow">Fresh picks</span>
              <h2 className="promo__title">See what arrived in store this week</h2>
              <p className="promo__sub">New produce and pantry lines, added as deliveries land.</p>
              <Link to="/products?sort=newest" className="btn">
                Browse new arrivals
                <Icon name="arrowRight" size={17} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <PopularProducts
        categories={categories}
        adding={adding}
        onAdd={(product) => void quickAdd(product)}
      />

      {/* Brand promise */}
      <section className="section section--wash" aria-labelledby="promise-title">
        <div className="container">
          <div className="brand-intro">
            <p className="eyebrow">Why Cibus</p>
            <h2 id="promise-title" className="section__title section__title--lg">
              Good food, plainly sourced.
            </h2>
            <p className="lede">
              We buy from verified suppliers, check what arrives, and price it honestly. What you
              see on the shelf is what you get in the basket.
            </p>
          </div>

          <div className="icon-boxes">
            {payload.highlights.map((highlight) => (
              <div key={highlight.title} className="icon-box">
                <span className="icon-box__icon">
                  <Icon name={iconFor(highlight.icon)} size={26} />
                </span>
                <h3>{highlight.title}</h3>
                <p>{highlight.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Shelf rail in catalogue order, opening on the first category */}
      {fresh.length > 0 ? (
        <section className="section" aria-labelledby="fresh-title">
          <div className="container">
            <header className="section__head">
              <div>
                <h2 id="fresh-title" className="section__title">
                  Fresh in store
                </h2>
                <p className="lede">The latest additions to our shelves.</p>
              </div>
              <Link to="/products" className="btn btn--ghost">
                See all
                <Icon name="arrowRight" size={17} />
              </Link>
            </header>

            <div className="fresh-slider">
              <div className="fresh-track" id="fresh-slider-track" ref={trackRef}>
                {[...fresh, ...fresh].map((product, index) => {
                  const duplicate = index >= fresh.length;
                  return (
                    <div
                      key={`${product.id}-${index}`}
                      className="fresh-track__item"
                      aria-hidden={duplicate || undefined}
                    >
                      <ProductCard
                        product={product}
                        adding={adding === product.id}
                        /* The copy is decorative, so it must not be tabbable. */
                        {...(duplicate ? {} : { onAdd: (item: Product) => void quickAdd(item) })}
                      />
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="fresh-slider__arrow fresh-slider__arrow--prev"
                aria-label="Previous products"
                aria-controls="fresh-slider-track"
                onClick={() => nudge(-1)}
              >
                <Icon name="chevronLeft" size={20} />
              </button>
              <button
                type="button"
                className="fresh-slider__arrow fresh-slider__arrow--next"
                aria-label="Next products"
                aria-controls="fresh-slider-track"
                onClick={() => nudge(1)}
              >
                <Icon name="arrowRight" size={20} />
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* How ordering works */}
      <section className="section section--tight" aria-labelledby="ordering-title">
        <div className="container">
          <div className="notice notice--wide">
            <Icon name="info" size={22} />
            <div>
              <strong id="ordering-title">How ordering works.</strong> Add what you need, sign in,
              and our team reviews every order before confirming. Payment is arranged directly with
              you, so nothing is charged automatically.
            </div>
            <Link to="/products" className="btn">
              Start shopping
            </Link>
          </div>
        </div>
      </section>

      {/* Closing full-bleed call to action */}
      <section className="cta-band" aria-labelledby="cta-title">
        <div className="container cta-band__inner">
          <p className="cta-band__eyebrow">Cibus Trading</p>
          <h2 id="cta-title" className="cta-band__title">
            Stock your kitchen with food you can trust.
          </h2>
          <p className="cta-band__sub">
            Pantry staples, fresh picks and everyday essentials, delivered with care. Browse the
            catalogue or talk to our team about a trade account.
          </p>
          <div className="cta-band__actions">
            <Link to="/products" className="btn btn--lg">
              Shop all products
              <Icon name="arrowRight" size={18} />
            </Link>
            <Link to="/page/about" className="btn btn--ghost btn--lg">
              Talk to our team
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
