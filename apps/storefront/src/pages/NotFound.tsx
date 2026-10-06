import { Link } from "react-router-dom";
import Icon from "../components/Icon.js";

export default function NotFound() {
  return (
    <div className="container section">
      <div className="empty-state">
        <div className="empty-state__icon">
          <Icon name="search" size={30} />
        </div>
        <h1>Page not found</h1>
        <p>The page you were looking for does not exist or has moved.</p>
        <Link to="/" className="btn">
          Back to home
        </Link>
      </div>
    </div>
  );
}