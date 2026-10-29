import { Link } from "react-router-dom";
import Icon from "../components/Icon.js";
import type { IconName } from "../components/Icon.js";
import PageHero from "../components/layout/PageHero.js";
import { useUi } from "../context/UiContext.js";

export default function Contact() {
  const { config } = useUi();
  const company = config?.company;

  const cards: { icon: IconName; label: string; value?: string; href?: string }[] = [
    {
      icon: "phone",
      label: "Call us",
      value: company?.phone,
      href: company?.phone ? `tel:${company.phone.replace(/[^\d+]/g, "")}` : undefined,
    },
    {
      icon: "mail",
      label: "Email",
      value: company?.email,
      href: company?.email ? `mailto:${company.email}` : undefined,
    },
    { icon: "mapPin", label: "Visit", value: company?.address },
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
                <a className="contact-card__value" href={card.href}>
                  {card.value}
                </a>
              ) : (
                <span className="contact-card__value">{card.value ?? "—"}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="notice notice--wide">
          <Icon name="info" size={22} />
          <div>
            <strong>Ready to order?</strong> Add what you need to your cart and sign in. Our team
            reviews every order and arranges payment with you directly.
          </div>
          <Link to="/products" className="btn">
            Browse products
          </Link>
        </div>
      </div>
    </>
  );
}
