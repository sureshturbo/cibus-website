import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon.js";
import { api } from "../api.js";
import type { StaticPage } from "../types.js";

export default function StaticPageView() {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<StaticPage | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setPage(null);
    setMissing(false);
    void api
      .page(slug)
      .then(setPage)
      .catch(() => setMissing(true));
  }, [slug]);

  if (missing) {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="search" size={30} />
          </div>
          <h1>Page not found</h1>
          <p>That page does not exist, or it has moved.</p>
          <Link to="/" className="btn">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  if (!page) return <div className="container section" aria-busy="true" />;

  const strengths = page.meta?.strengthsTitle;
  const paragraphs = page.body ? page.body.split(/\n{2,}/) : [];

  return (
    <>
      <div className="page-head">
        <div className="container">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <Icon name="chevronRight" size={14} />
            <span>{page.title}</span>
          </nav>
          <h1 className="page-head__title">{page.title}</h1>
          {page.subtitle ? <p className="page-subtitle">{page.subtitle}</p> : null}
        </div>
      </div>

      <div className="container section">
        {/* The API ships body copy only, so nothing here invents content the
            company has not written; `strengthsTitle` is the one extra heading
            it supplies and is used as given. */}
        {typeof strengths === "string" ? <h2 className="section__title">{strengths}</h2> : null}

        <div className="prose">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </div>
    </>
  );
}