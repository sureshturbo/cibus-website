import { Link } from "react-router-dom";
import Icon from "../Icon.js";
import { DEFAULT_PAGE_HERO_IMAGE, PAGE_HERO_IMAGES } from "../../api.js";

/** Photographic page header shared by the information pages. */
export default function PageHero({
  slug,
  title,
  subtitle,
}: {
  slug: string;
  title: string;
  subtitle?: string | null;
}) {
  return (
    <header className="page-hero">
      <img
        className="page-hero__bg"
        src={PAGE_HERO_IMAGES[slug] ?? DEFAULT_PAGE_HERO_IMAGE}
        alt=""
      />
      <div className="container page-hero__inner">
        <nav className="breadcrumbs page-hero__crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <Icon name="chevronRight" size={14} />
          <span>{title}</span>
        </nav>
        {subtitle ? <p className="page-hero__eyebrow">{subtitle}</p> : null}
        <h1 className="page-hero__title">{title}</h1>
      </div>
    </header>
  );
}
