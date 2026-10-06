import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon, { iconFor } from "../components/Icon.js";
import { ProductCard } from "../components/ProductCard.js";
import { api, PLACEHOLDER_IMAGES } from "../api.js";
import { useCart } from "../context/CartContext.js";
import { useUi } from "../context/UiContext.js";
import { useToast } from "../components/ui/Toast.js";
import type { HomePayload } from "../types.js";

/** Hero copy is a single sentence split around the emphasised phrase. */
function HeroSlider({ payload }: { payload: HomePayload }) {
  const slides = useMemo(() => {
    const { hero } = payload;
    return [
      {
key: "primary",
        image: PLACEHOLDER_IMAGES.hero,
        title: (
          <>
            {hero.headline} <em>{hero.highlight}</em>
          </>
        ),
        sub: hero.subheadline,
        primary: { label: hero.primaryCta, to: "/products" },
        secondary: { label: hero.secondaryCta, to: "/page/about" },
      },
      {
key: "products",
        image: PLACEHOLDER_IMAGES.category,
        title: (
          <>
            Fresh essentials <em>delivered</em> to your doorstep
          </>
        ),
        sub: "Browse our curated selection of everyday groceries.",
        primary: { label: "Food Products", to: "/products" },
        secondary: { label: "About Us", to: "/page/about" },
      },
      {
key: "contact",
        image: PLACEHOLDER_IMAGES.feature,
        title: (
          <>
            Your trusted <em>trade partner</em>
          </>
        ),
        sub: "Wholesale rates and reliable supply for kitchens & institutions.",
        primary: { label: "Get in touch", to: "#contact" },
        secondary: { label: "View catalogue", to: "/products" },
      },
    ];
  }, [payload]);

  const [active, setActive] = useState(0);

  // One slide, but the control is kept so adding content later needs no rewrite.
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const slide = slides[active];
  if (!slide) return null;

  return (
    <section className="hero">
        <div className="container">
          <div className="hero__slide hero__slide--active" key={slide.key}>
            <div className="hero__body">
              <h1 className="hero__title">{slide.title}</h1>
              <p className="hero__sub">{slide.sub}</p>
              <div className="hero__actions">
                <Link to={slide.primary.to} className="btn btn--lg">
                  {slide.primary.label}
                  <Icon name="arrowRight" size={18} />
                </Link>
                <Link to={slide.secondary.to} className="btn btn--ghost btn--lg">
                  {slide.secondary.label}
                </Link>
              </div>
            </div>
            {slides.length > 1 ? (
              <>
                <div className="hero__dots">
                  {slides.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      className={index === active ? "hero__dot hero__dot--active" : "hero__dot"}
                      aria-label={`Go to slide ${index + 1}`}
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
            <div className="hero__art" aria-hidden="true">
              <div className="hero__panel">
                <img src={slide.image} alt="" loading="eager" />
              </div>
            </div>
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

  useEffect(() => {
    void api
      .home()
      .then(setPayload)
      .catch(() => setError("We could not load the homepage just now. Please refresh."));
  }, []);

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

  if (!payload) return <div className="container section" aria-busy="true" />;

  const featured = payload.featuredProducts.slice(0, 8);

  return (
    <>
      <HeroSlider payload={payload} />

      {/* Category tiles */}
      {categories.length > 0 ? (
        <section className="section">
          <div className="container">
            <header className="section__head">
              <h2 className="section__title">Shop by category</h2>
              <p className="lede">{payload.categoriesBlurb}</p>
            </header>

            <div className="cat-tiles">
              {categories.slice(0, 6).map((category) => (
                <Link key={category.id} to={`/products?category=${category.slug}`} className="cat-tile">
<img
                    src={category.imageUrl ?? PLACEHOLDER_IMAGES.category}
                    alt=""
                    loading="lazy"
                  />
                  <span className="cat-tile__label">
                    <span className="cat-tile__name">{category.name}</span>
                    <span className="cat-tile__count">
                      {category.productCount} product{category.productCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Two-up campaign banners */}
      <section className="section section--tight">
        <div className="container">
          <div className="promo-row">
            <div className="promo">
              <span className="promo__eyebrow">Trade accounts</span>
              <h3 className="promo__title">Wholesale rates for kitchens and institutions</h3>
              <Link to="/page/about" className="btn">
                Partner with us
                <Icon name="arrowRight" size={17} />
              </Link>
            </div>

            <div className="promo promo--alt">
              <span className="promo__eyebrow">Fresh picks</span>
              <h3 className="promo__title">See what arrived in store this week</h3>
              <Link to="/products?sort=newest" className="btn">
                Browse new arrivals
                <Icon name="arrowRight" size={17} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Featured products */}
      {featured.length > 0 ? (
        <section className="section">
          <div className="container">
            <header className="section__head">
              <div>
                <h2 className="section__title">Featured products</h2>
                <p className="lede">Hand-picked from our catalogue.</p>
              </div>
              <Link to="/products" className="btn btn--ghost">
                View all
                <Icon name="arrowRight" size={17} />
              </Link>
            </header>

            <div className="products-grid">
              {featured.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  adding={adding === product.id}
                  onAdd={(target) => void quickAdd(target.id)}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Why-us feature split */}
      <section className="section section--wash">
        <div className="container">
          <div className="split">
            <div className="split__media">
              <img src={PLACEHOLDER_IMAGES.feature} alt="" loading="lazy" />
            </div>
            <div>
              <h2 className="split__title">Supply you do not have to chase</h2>
              <p className="split__body">
                We buy from verified suppliers, check what arrives, and price it plainly. No hidden
                charges appear at the till, and a real person answers when something goes wrong.
              </p>
              <Link to="/page/what-we-do" className="btn">
                See how we work
                <Icon name="arrowRight" size={17} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Service promises, from the API's own highlights */}
      <section className="section">
        <div className="container">
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

      {/* Newest arrivals */}
      {payload.newestProducts.length > 0 ? (
        <section className="section section--tight">
          <div className="container">
            <header className="section__head">
              <div>
                <h2 className="section__title">New arrivals</h2>
                <p className="lede">The latest additions to our shelves.</p>
              </div>
              <Link to="/products?sort=newest" className="btn btn--ghost">
                See all
                <Icon name="arrowRight" size={17} />
              </Link>
            </header>

            <div className="rail">
              {payload.newestProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  adding={adding === product.id}
                  onAdd={(target) => void quickAdd(target.id)}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Closing call to action */}
      <section className="section section--tight">
        <div className="container">
          <div className="notice notice--wide">
            <Icon name="info" size={22} />
            <div>
              <strong>How ordering works.</strong> Add what you need, sign in, and our team reviews
              every order before confirming. Payment is arranged directly with you, so nothing is
              charged automatically.
            </div>
            <Link to="/products" className="btn">
              Start shopping
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
