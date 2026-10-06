import { Link } from "react-router-dom";
import Icon from "./../Icon.js";
import type { IconName } from "./../Icon.js";
import { useUi } from "../../context/UiContext.js";

const SOCIAL_ICONS: Record<string, IconName> = {
  x: "x",
  twitter: "x",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
};

export default function Footer() {
  const { config, categories } = useUi();
  const company = config?.company;
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer__cols">
        <div>
          <Link to="/" className="brand">
            <span className="brand__mark">
              Cibus<em>Trading</em>
            </span>
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
          <h4 className="footer__title">Shop</h4>
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
          <h4 className="footer__title">Company</h4>
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
              <Link to="/account/orders">Track an order</Link>
            </li>
          </ul>
        </div>

        <div id="contact">
          <h4 className="footer__title">Get in touch</h4>
          <ul className="footer__contact">
            <li className="footer__contact-item">
              <Icon name="mapPin" size={17} />
              {company?.address}
            </li>
            <li className="footer__contact-item">
              <Icon name="phone" size={17} />
              {company?.phone}
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
          &copy; {year} {company?.name ?? "Cibus Trading"}. All rights reserved.
        </span>
        <span>
          <Icon name="shield" size={15} />
          Payments are arranged when we confirm your order.
        </span>
      </div>
    </footer>
  );
}