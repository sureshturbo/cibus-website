import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon.js";
import { discountPercent, formatMoney, primaryImageOf } from "../api.js";
import type { Product, ProductImage, RelatedProduct } from "../types.js";

/** The one shape the card needs, so catalogue and related cards cannot drift. */
interface CardData {
  id: number;
  name: string;
  slug: string;
  price: number;
  compareAtPrice: number | null;
  unitLabel: string;
  categoryName: string | null;
  images: ProductImage[];
  primaryImage: ProductImage | null;
  inStock: boolean;
}

function toCardData(
  source: Product | RelatedProduct,
  categoryName: string | null,
): CardData {
  const catalogue = source as Product;

  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    price: source.price,
    compareAtPrice: source.compareAtPrice,
    unitLabel: source.unitLabel,
    categoryName,
    images: source.images,
    primaryImage: primaryImageOf(source),
    inStock: catalogue.inStock ?? source.stockQuantity > 0,
  };
}

function Card({
  data,
  onAdd,
  adding = false,
}: {
  data: CardData;
  onAdd?: () => void;
  adding?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const image = data.primaryImage;
  const percent = discountPercent(data.price, data.compareAtPrice);

  return (
    <article className="card">
      <div className="card__media">
        {image && !failed ? (
          <img
            className="card__img"
            src={failed ? "/images/product.webp" : image.url}
            alt={image.altText ?? data.name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="card__placeholder" aria-hidden="true">
            {data.name.slice(0, 1).toUpperCase()}
          </span>
        )}

        <div className="card__badges">
          {percent ? <span className="badge badge--sale">-{percent}%</span> : null}
          {!data.inStock ? <span className="badge badge--out">Sold out</span> : null}
        </div>

        <div className="card__tools">
          <Link
            to={`/product/${data.slug}`}
            className="icon-btn icon-btn--on-media"
            aria-label={`View ${data.name}`}
          >
            <Icon name="eye" size={17} />
          </Link>
        </div>

        {onAdd && data.inStock ? (
          <div className="card__atc">
            <button
              type="button"
              className="icon-btn icon-btn--primary"
              aria-label={`Add ${data.name} to cart`}
              disabled={adding}
              onClick={onAdd}
            >
              <Icon name="cart" size={17} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="card__body">
        {data.categoryName ? <span className="card__category">{data.categoryName}</span> : null}

        <h3 className="card__title">
          <Link to={`/product/${data.slug}`}>{data.name}</Link>
        </h3>

        <div className="card__price">
          <span className="card__price-now">{formatMoney(data.price)}</span>
          {percent ? (
            <span className="card__price-was">{formatMoney(data.compareAtPrice ?? 0)}</span>
          ) : null}
          <span className="card__unit">/ {data.unitLabel}</span>
        </div>

        <span className={data.inStock ? "card__stock card__stock--in" : "card__stock card__stock--out"}>
          {data.inStock ? "In stock" : "Out of stock"}
        </span>
      </div>
    </article>
  );
}

interface ProductCardProps {
  product: Product;
  onAdd?: (product: Product) => void;
  adding?: boolean;
}

/**
 * Catalogue card. The reference's hover overlay carries wishlist and quick view,
 * neither of which has a backend here, so the overlay shows the action that
 * does work instead of a control that cannot.
 */
export function ProductCard({ product, onAdd, adding = false }: ProductCardProps) {
  return (
    <Card
      data={toCardData(product, product.category?.name ?? null)}
      {...(onAdd ? { onAdd: () => onAdd(product) } : {})}
      adding={adding}
    />
  );
}

/** Same visual, for the same-category suggestions on the detail page. */
export function RelatedCard({
  product,
  categoryName,
}: {
  product: RelatedProduct;
  categoryName: string | null;
}) {
  return <Card data={toCardData(product, categoryName)} />;
}