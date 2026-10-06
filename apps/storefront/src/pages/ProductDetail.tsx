import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon.js";
import { RelatedCard } from "../components/ProductCard.js";
import QuantityStepper from "../components/ui/QuantityStepper.js";
import { api, discountPercent, formatMoney, primaryImageOf } from "../api.js";
import { useCart } from "../context/CartContext.js";
import { useAuth } from "../context/AuthContext.js";
import { useUi } from "../context/UiContext.js";
import { useToast } from "../components/ui/Toast.js";
import type { ProductDetail } from "../types.js";

export default function ProductDetail() {
  const { slug = "" } = useParams();
  const { add } = useCart();
  const { user, ready } = useAuth();
  const { open } = useUi();
  const toast = useToast();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setProduct(null);
    setError(null);
    setQuantity(1);
    setActiveImage(0);

    void api
      .product(slug)
      .then(setProduct)
      .catch(() => setError("We could not find that product."));
  }, [slug]);

  if (error) {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="box" size={30} />
          </div>
          <h1>Product not found</h1>
          <p>It may have been removed from the catalogue.</p>
          <Link to="/products" className="btn">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  if (!product) return <div className="container section" aria-busy="true" />;

  const image = product.images[activeImage] ?? primaryImageOf(product);
  const percent = discountPercent(product.price, product.compareAtPrice);
  const maxQuantity = product.maxQuantity;

  const addToCart = async () => {
    // Checkout requires an account, so the sheet is the only sensible next step
    // for a signed-out shopper with something in their basket.
    if (ready && !user) {
      open("auth");
      return;
    }

    setAdding(true);
    try {
      await add(product.id, quantity);
      toast.push(
        <>
          {product.name} added to your cart.{" "}
          <Link to="/cart">View cart</Link>
        </>,
      );
      setQuantity(1);
    } catch {
      toast.push("That item could not be added. Please try again.", "error");
    } finally {
      setAdding(false);
    }
  };

  const buyBlock = (
    <div className="detail__buy">
      {product.inStock ? (
        <>
          <QuantityStepper
            value={quantity}
            min={1}
            max={maxQuantity}
            disabled={adding}
            label={`Quantity of ${product.name}`}
            onChange={setQuantity}
          />
          <button type="button" className="btn btn--lg" disabled={adding} onClick={() => void addToCart()}>
            <Icon name="cart" size={18} />
            {adding ? "Adding" : "Add to cart"}
          </button>
        </>
      ) : (
        <p className="notice notice--warn">
          <Icon name="alert" size={18} />
          This item is out of stock. Contact us and we will tell you when it returns.
        </p>
      )}
    </div>
  );

  const related = product.related ?? [];

  return (
    <>
      <div className="page-head">
        <div className="container">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <Icon name="chevronRight" size={14} />
            <Link to="/products">Products</Link>
            {product.category ? (
              <>
                <Icon name="chevronRight" size={14} />
                <Link to={`/products?category=${product.category.slug}`}>{product.category.name}</Link>
              </>
            ) : null}
            <Icon name="chevronRight" size={14} />
            <span>{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="container section">
        <div className="detail">
          <div className="gallery">
            <div className="gallery__main">
              {image ? (
                <img src={image.url} alt={image.altText ?? product.name} />
              ) : (
                <span className="card__placeholder" aria-hidden="true">
                  {product.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              {percent ? <span className="badge badge--sale gallery__badge">-{percent}%</span> : null}
            </div>

            {product.images.length > 1 ? (
              <div className="gallery__thumbs">
                {product.images.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="gallery__thumb"
                    aria-current={index === activeImage}
                    aria-label={`Show image ${index + 1}`}
                    onClick={() => setActiveImage(index)}
                  >
                    <img src={entry.url} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="detail__info">
            {product.category ? (
              <Link to={`/products?category=${product.category.slug}`} className="card__category">
                {product.category.name}
              </Link>
            ) : null}

            <h1 className="detail__title">{product.name}</h1>

            <p className="detail__meta">
              SKU {product.sku} &middot; sold per {product.unitLabel}
            </p>

            <div className="detail__price">
              <span className="detail__price-now">{formatMoney(product.price)}</span>
              {percent ? (
                <span className="detail__price-was">{formatMoney(product.compareAtPrice ?? 0)}</span>
              ) : null}
            </div>

            {product.shortDescription ? <p className="detail__desc">{product.shortDescription}</p> : null}

            {buyBlock}

            <dl className="detail__meta-list">
              <div className="detail__meta-row">
                <dt>Availability</dt>
                <dd>
                  {product.inStock
                    ? `In stock (${product.stockQuantity} available)`
                    : "Out of stock"}
                </dd>
              </div>
              <div className="detail__meta-row">
                <dt>SKU</dt>
                <dd>{product.sku}</dd>
              </div>
              <div className="detail__meta-row">
                <dt>Sold as</dt>
                <dd>{product.unitLabel}</dd>
              </div>
            </dl>
          </div>
        </div>

        {product.description ? (
          <section className="section">
            <h2 className="section__title">Product details</h2>
            <div className="prose">
              {product.description.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {related.length > 0 ? (
        <section className="section section--tight">
          <div className="container">
            <header className="section__head">
              <h2 className="section__title">You may also like</h2>
            </header>

            <div className="rail">
              {related.map((entry) => (
                <RelatedCard key={entry.id} product={entry} categoryName={product.category?.name ?? null} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Sticky add-to-cart, mirroring the reference's mobile treatment. */}
      {product.inStock ? (
        <div className="sticky-atc sticky-atc--visible">
          <span className="sticky-atc__price">
            <small>{product.name}</small>
            <b>{formatMoney(product.price * quantity)}</b>
          </span>
          <button type="button" className="btn" disabled={adding} onClick={() => void addToCart()}>
            Add to cart
          </button>
        </div>
      ) : null}
    </>
  );
}