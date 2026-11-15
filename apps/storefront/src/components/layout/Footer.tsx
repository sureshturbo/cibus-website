import { Link } from "react-router-dom";
import Icon from "./../Icon.js";
import type { IconName } from "./../Icon.js";
import { BRAND_LOGO } from "../../api.js";
import { useUi } from "../../context/UiContext.js";
import { SHOP_ENABLED } from "../../config.js";

const SOCIAL_ICONS: Record<string, IconName> = {
  x: "x",
  twitter: "x",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
};

/** The company phone field can hold several numbers separated by commas. */
export function phoneNumbers(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,/]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function Footer() {
  const { config, categories } = useUi();
  const company = config?.company;
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer__cols">
        <div>
          <Link to="/" className="brand" aria-label={`${company?.name ?? "Cibus Trading Inc."} home`}>
            <img
              className="brand__logo"
              src={BRAND_LOGO}
              alt={company?.name ?? "Cibus Trading Inc."}
              width={463}
              height={400}
            />
            <span className="brand__tagline">{company?.tagline ?? "Quality provisions"}</span>
          </Link>

          <p className="muted" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)" }}>
            {company?.description}
          </p>

          {company?.socialLinks?.length ? (
            <div className="footer__social">
              {company.socialLinks.map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={link.platform}
                >
                  <Icon name={SOCIAL_ICONS[link.platform.toLowerCase()] ?? "info"} size={17} />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <h2 className="footer__title">Shop</h2>
          <ul className="footer__list">
            <li>
              <Link to="/products">All products</Link>
            </li>
            {categories.slice(0, 6).map((category) => (
              <li key={category.id}>
                <Link to={`/products?category=${category.slug}`}>{category.name}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="footer__title">Company</h2>
          <ul className="footer__list">
            <li>
              <Link to="/page/about">About us</Link>
            </li>
            <li>
              <Link to="/page/what-we-do">What we do</Link>
            </li>
            <li>
              <Link to="/page/vision">Our vision</Link>
            </li>
            <li>
              <Link to="/page/mission">Our mission</Link>
            </li>
            <li>
              <Link to="/contact">Contact us</Link>
            </li>
            {SHOP_ENABLED ? (
              <li>
                <Link to="/account/orders">Track an order</Link>
              </li>
            ) : null}
            <li>
              <Link to="/page/privacy-policy">Privacy policy</Link>
            </li>
          </ul>
        </div>

        <div id="contact">
          <h2 className="footer__title">Get in touch</h2>
          <ul className="footer__contact">
            <li className="footer__contact-item">
              <Icon name="mapPin" size={17} />
              {company?.mapUrl ? (
                <a href={company.mapUrl} target="_blank" rel="noreferrer noopener">
                  {company.address}
                </a>
              ) : (
                company?.address
              )}
            </li>
            <li className="footer__contact-item">
              <Icon name="phone" size={17} />
              <span>
                {phoneNumbers(company?.phone).map((number, index) => (
                  <span key={number}>
                    {index > 0 ? " / " : ""}
                    <a href={`tel:${number.replace(/[^\d+]/g, "")}`}>{number}</a>
                  </span>
                ))}
              </span>
            </li>
            <li className="footer__contact-item">
              <Icon name="mail" size={17} />
              <a href={`mailto:${company?.email}`}>{company?.email}</a>
            </li>
            <li className="footer__contact-item">
              <Icon name="clock" size={17} />
              {company?.businessHours}
            </li>
          </ul>
        </div>
      </div>

      <div className="container footer__bar">
        <span>
          &copy; {year} {company?.name ?? "Cibus Trading Inc."}. All rights reserved.
        </span>
        <span>
          <Icon name="shield" size={15} />
          {SHOP_ENABLED
            ? "Payments are arranged when we confirm your order."
            : "Contact our sales team for prices and orders."}
        </span>
      </div>
    </footer>
  );
}