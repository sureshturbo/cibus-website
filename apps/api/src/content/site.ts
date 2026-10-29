/**
 * Editorial content for the storefront's non-catalogue pages.
 *
 * Lives in code rather than the database because the proposal does not include
 * a content-management feature: these pages are edited by a developer and
 * deployed. If the client later wants to edit copy from the admin panel, move
 * these structures behind a `site_content` key-value table and cache on read -
 * the shape here is already the payload a row would hold.
 *
 * Business copy is intentionally NOT duplicated in the React apps. The API is
 * the single source, so the storefront and any future client stay consistent.
 */

export interface ContentSection {
  slug: string;
  title: string;
  subtitle?: string;
  body?: string;
  meta: Record<string, unknown>;
}

export interface CompanyInfo {
  name: string;
  tagline: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  businessHours: string;
  socialLinks: Array<{ platform: string; url: string }>;
}

export interface HomeContent {
  hero: {
    headline: string;
    highlight: string;
    subheadline: string;
    primaryCta: string;
    secondaryCta: string;
  };
  highlights: Array<{ title: string; description: string; icon: string }>;
  categoriesBlurb: string;
}

export interface StaticPageContent {
  about: ContentSection;
  vision: ContentSection;
  mission: ContentSection;
  whatWeDo: ContentSection;
  privacy: ContentSection;
}

export const COMPANY_INFO: CompanyInfo = {
  name: "Cibus Trading",
  tagline: "Quality provisions, delivered with care",
  description:
    "Cibus Trading supplies dependable food and everyday essentials to homes and businesses, with transparent pricing and dependable delivery.",
  email: "hello@cibus.example",
  phone: "+91 00000 00000",
  address: "Cibus Trading, Business Address, India",
  businessHours: "Monday to Saturday, 9:00 - 19:00",
  socialLinks: [
    { platform: "X", url: "https://x.com" },
    { platform: "Instagram", url: "https://instagram.com" },
    { platform: "LinkedIn", url: "https://linkedin.com" },
  ],
};

export const HOME_CONTENT: HomeContent = {
  hero: {
    headline: "Everyday essentials, sourced with",
    highlight: "care and delivered fast",
    subheadline:
      "From pantry staples to fresh picks, Cibus Trading keeps homes and kitchens supplied without the guesswork.",
    primaryCta: "Browse products",
    secondaryCta: "Partner with us",
  },
  highlights: [
    {
      title: "Quality you can check",
      description: "Every batch is sourced from verified suppliers and inspected before it reaches our shelves.",
      icon: "shield",
    },
    {
      title: "Honest pricing",
      description: "Clear product pricing with no hidden charges added at the till.",
      icon: "tag",
    },
    {
      title: "Reliable delivery",
      description: "Scheduled dispatch and careful packing so your order arrives the way it left us.",
      icon: "truck",
    },
    {
      title: "Trade accounts",
      description: "Partner with us for wholesale rates, priority stock and dedicated account support.",
      icon: "handshake",
    },
  ],
  categoriesBlurb: "Browse our catalogue by category to find exactly what you need.",
};

export const STATIC_PAGES: StaticPageContent = {
  about: {
    slug: "about",
    title: "About Cibus Trading",
    subtitle: "Who we are",
    body: [
      "Cibus Trading began with a straightforward idea: sourcing food and everyday essentials should not be complicated. We work directly with trusted suppliers, inspect what arrives, and pass it on at a fair price.",
      "Today we supply households, restaurants and institutions across the region. Our catalogue covers pantry staples, fresh produce, packaged goods and cleaning supplies, and it keeps growing as our customers ask for more.",
      "We are a small team that answers its own phone. If something is wrong with an order, tell us and we will make it right.",
    ].join("\n\n"),
    meta: { strengthsTitle: "What sets us apart" },
  },
  vision: {
    slug: "vision",
    title: "Our Vision",
    subtitle: "Where we are heading",
    body: [
      "To become the trading partner that businesses and families in our region turn to first, for dependable quality, clear pricing and service that answers the phone.",
      "We want our catalogue to be the one people trust without checking twice, and our delivery record to be one they can plan around.",
    ].join("\n\n"),
    meta: {
      pillars: [
        "Dependable supply",
        "Transparent pricing",
        "Long-term partnerships",
      ],
    },
  },
  mission: {
    slug: "mission",
    title: "Our Mission",
    subtitle: "What we do every day",
    body: [
      "To source, store and supply quality provisions efficiently and honestly, so that a customer who orders today receives what they expected.",
      "Our operating commitments:",
    ].join("\n\n"),
    meta: {
      commitments: [
        "Inspect every incoming batch before it reaches the catalogue",
        "Quote prices plainly, with no charges added later",
        "Pack and dispatch on the day an order is confirmed",
        "Resolve complaints directly and without delay",
      ],
    },
  },
  whatWeDo: {
    slug: "what-we-do",
    title: "What We Do",
    subtitle: "Our business activities",
    body: [
      "Cibus Trading operates across four areas: sourcing and quality control, wholesale and retail supply, order fulfilment and delivery, and trade partnerships for bulk buyers.",
      "We work with households buying for a week and with kitchens and institutions buying in bulk. The same catalogue, the same standards, different volumes.",
    ].join("\n\n"),
    meta: {
      activities: [
        {
          title: "Sourcing and quality control",
          description: "We buy from verified suppliers and check incoming batches for freshness, packaging integrity and labelling compliance.",
        },
        {
          title: "Wholesale and retail supply",
          description: "Households, restaurants, caterers and institutions order from one catalogue at trade rates.",
        },
        {
          title: "Order fulfilment and delivery",
          description: "Orders are packed to order and dispatched on the day they are confirmed, with delivery across our service area.",
        },
        {
          title: "Trade partnerships",
          description: "Businesses that buy regularly receive dedicated pricing, priority stock allocation and a named account contact.",
        },
      ],
    },
  },
  // "## " lines in the body render as section headings on the storefront.
  privacy: {
    slug: "privacy-policy",
    title: "Privacy Policy",
    subtitle: "How we handle your information",
    body: [
      "This policy explains what information Cibus Trading collects when you use this website, why we collect it, and the choices you have. Last updated: 29 October 2026.",
      "## Information we collect",
      "When you create an account or place an order we collect your name, email address, phone number and delivery address, together with the details of the orders you place. If you send us a trade enquiry, we keep the details you submit with it.",
      "## How we use it",
      "We use your information to review and confirm your orders, arrange payment and delivery, contact you about an order, and answer your enquiries. We do not use it for advertising and we do not sell it.",
      "## Payments",
      "No payment is taken on this website. Payment is arranged directly with you when we confirm your order, so we never receive or store your card details here.",
      "## Cookies",
      "We use only the cookies needed for the site to work: two keep you signed in and one remembers the contents of your cart. We do not use advertising or tracking cookies.",
      "## Sharing",
      "We share your details only where it is needed to fulfil your order, for example with a delivery partner, or where the law requires it.",
      "## Keeping your information safe",
      "Passwords are stored in a scrambled form that cannot be read back, and access to customer records is limited to staff who need it to handle orders. We keep order records for as long as we need them for accounting and legal purposes.",
      "## Your choices",
      "You can view and update your account details at any time. To ask for a copy of your information, a correction, or for your account to be deleted, contact us using the details on our Contact page.",
      "## Changes to this policy",
      "If we change how we handle your information we will update this page and the date above.",
    ].join("\n\n"),
    meta: {},
  },
};