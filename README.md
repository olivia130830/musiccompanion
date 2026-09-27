# MusicCompanion

## Account authentication

The app uses its own NestJS authentication service, PostgreSQL, and Nodemailer with Gmail SMTP. Supabase is not used.

Create `.env.local` from the included template:

```bash
cp .env.example .env.local
```

Then configure:

```bash
AUTH_BACKEND_URL=http://127.0.0.1:4000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
DATABASE_SSL=false
OTP_HASH_SECRET=generate-a-random-secret-of-at-least-32-characters
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM=MusicCompanion <your-account@gmail.com>
```

`SMTP_PASS` must be a Google App Password. Enable two-step verification on the Google account, then create an app password; do not use the normal Gmail password.

`npm run dev` starts all three local processes:

- NestJS account service on `127.0.0.1:4000`
- Qwen realtime proxy on `127.0.0.1:8787`
- Next.js on `127.0.0.1:3000`

The NestJS service creates the required PostgreSQL tables and indexes automatically. Verification codes expire after 10 minutes, are hashed before storage, allow five attempts, and are limited to one send per minute and five sends per hour per email.

For production, deploy the NestJS service to a persistent Node.js host and set Vercel's `AUTH_BACKEND_URL` to its HTTPS URL. The Next.js rewrite keeps browser requests first-party so the session can remain in an HttpOnly cookie.

Password login, password registration, OTP login, session refresh, sign-out, protected pages, and protected API routes are included.

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

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
