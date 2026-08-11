This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Environment variables

See [`.env.example`](.env.example) for the full list. Backend secrets live on the
Convex deployment (set with `npx convex env set NAME value`), not in `.env.local`.
Only `NEXT_PUBLIC_*` vars are read by the Next.js frontend.

## Billing setup (Stripe)

Billing is handled through Stripe, driven by `convex/billing.ts`. Pricing is
single-sourced from `convex/lib/tiers.ts` — a one-time bootstrap creates the
matching Stripe Products/Prices.

1. Create a Stripe account and grab a **test** secret key (`sk_test_…`).
2. Set it on the Convex deployment: `npx convex env set STRIPE_SECRET_KEY sk_test_…`
3. Create the Products/Prices/coupon in Stripe: `npx convex run billing:bootstrapStripe`
   (idempotent — safe to re-run; ids are stored in the `billingConfig` table).
4. Register the webhook endpoint in the Stripe dashboard (or via `stripe listen`):
   `https://<your-deployment>.convex.site/stripe/webhook`. Copy its signing secret:
   `npx convex env set STRIPE_WEBHOOK_SECRET whsec_…`
5. Test checkout with card `4242 4242 4242 4242` (any future expiry / CVC).

Go live later by repeating with live keys on the production deployment.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
