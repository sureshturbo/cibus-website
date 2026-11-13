import { Link } from "react-router-dom";
import Icon from "../components/Icon.js";
import type { IconName } from "../components/Icon.js";
import PageHero from "../components/layout/PageHero.js";
import { useUi } from "../context/UiContext.js";
import { phoneNumbers } from "../components/layout/Footer.js";
import { SHOP_ENABLED } from "../config.js";

/* The shared maps.app.goo.gl link cannot be framed, so the embed uses the pin's
   coordinates that link resolves to. Update both together if the office moves. */
const MAP_EMBED_URL = "https://maps.google.com/maps?q=6.753327,-58.157696&z=16&output=embed";

export default function Contact() {
  const { config } = useUi();
  const company = config?.company;

  const cards: { icon: IconName; label: string; value?: string; href?: string }[] = [
    ...phoneNumbers(company?.phone).map((number, index) => ({
      icon: "phone" as IconName,
      label: index === 0 ? "Call us" : "Or call",
      value: number,
      href: `tel:${number.replace(/[^\d+]/g, "")}`,
    })),
    {
      icon: "mail",
      label: "Email",
      value: company?.email,
      href: company?.email ? `mailto:${company.email}` : undefined,
    },
    {
      icon: "mapPin",
      label: "Visit",
      value: company?.address,
      href: company?.mapUrl,
    },
    { icon: "clock", label: "Business hours", value: company?.businessHours },
  ];

  return (
    <>
      <PageHero slug="contact" title="Contact Us" subtitle="We are here to help" />

      <div className="container section">
        <p className="lede contact-intro">
          Questions about a product, an order or a trade account? Reach our team directly and we
          will get back to you.
        </p>

        <ul className="contact-grid">
          {cards.map((card) => (
            <li key={card.label} className="contact-card">
              <span className="contact-card__icon">
                <Icon name={card.icon} size={24} />
              </span>
              <span className="contact-card__label">{card.label}</span>
              {card.href ? (
                <a
                  className="contact-card__value"
                  href={card.href}
                  {...(card.href.startsWith("http")
                    ? { target: "_blank", rel: "noreferrer noopener" }
                    : {})}
                >
                  {card.value}
                </a>
              ) : (
                <span className="contact-card__value">{card.value ?? "—"}</span>
              )}
            </li>
          ))}
        </ul>

        <section className="contact-map" aria-labelledby="map-title">
          <div className="contact-map__head">
            <h2 id="map-title" className="section__title">
              Find us
            </h2>
            {company?.mapUrl ? (
              <a
                href={company.mapUrl}
                className="btn btn--ghost btn--sm"
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="mapPin" size={16} />
                Open in Google Maps
              </a>
            ) : null}
          </div>
          <iframe
            className="contact-map__frame"
            title={`Map showing ${company?.name ?? "our"} location`}
            src={MAP_EMBED_URL}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </section>

        <div className="notice notice--wide">
          <Icon name="info" size={22} />
          <div>
            {SHOP_ENABLED ? (
              <>
                <strong>Ready to order?</strong> Add what you need to your cart and sign in. Our
                team reviews every order and arranges payment with you directly.
              </>
            ) : (
              <>
                <strong>Need a price or want to order?</strong> Email or call our sales team with
                the products and quantities you need and we will get back to you.
              </>
            )}
          </div>
          <Link to="/products" className="btn">
            Browse products
          </Link>
        </div>
      </div>
    </>
  );
}
