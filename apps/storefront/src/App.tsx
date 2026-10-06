import { Route, Routes } from "react-router-dom";
import Layout from "./components/layout/Layout.js";
import { CartProvider } from "./context/CartContext.js";
import { AuthProvider } from "./context/AuthContext.js";
import { UiProvider } from "./context/UiContext.js";
import { ToastProvider } from "./components/ui/Toast.js";
import Home from "./pages/Home.js";
import Products from "./pages/Products.js";
import ProductDetail from "./pages/ProductDetail.js";
import CartPage from "./pages/CartPage.js";
import Checkout from "./pages/Checkout.js";
import Account from "./pages/Account.js";
import OrderConfirmationPage from "./pages/OrderConfirmation.js";
import StaticPageView from "./pages/StaticPage.js";
import NotFound from "./pages/NotFound.js";

/**
 * Provider order matters: the cart is needed to merge a guest basket at sign-in,
 * so it wraps auth, and UI state wraps everything because the shell's overlays
 * are opened from any page.
 */
export default function App() {
  return (
    <CartProvider>
      <AuthProvider>
        <UiProvider>
          <ToastProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="products" element={<Products />} />
                <Route path="product/:slug" element={<ProductDetail />} />
                <Route path="cart" element={<CartPage />} />
                <Route path="checkout" element={<Checkout />} />
                <Route path="order-confirmation/:id" element={<OrderConfirmationPage />} />
                <Route path="account" element={<Account />} />
                <Route path="account/orders" element={<Account />} />
                <Route path="page/:slug" element={<StaticPageView />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </ToastProvider>
        </UiProvider>
      </AuthProvider>
    </CartProvider>
  );
}