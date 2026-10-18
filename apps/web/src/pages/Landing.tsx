import { Link } from "react-router-dom";
import { useLocale } from "../lib/i18n/index.js";
import { CreditPill } from "../components/credit.js";
import { ICONS, Icon, ThemeToggle, Wordmark } from "../components/ui.js";

const REPO = "https://github.com/junaaid96/scope-lock";

function GithubMark(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function LandingPage(): JSX.Element {
  const { t } = useLocale();
  const features = [
    { icon: ICONS.list, title: t("landing.f1Title"), body: t("landing.f1Body") },
    { icon: ICONS.git, title: t("landing.f2Title"), body: t("landing.f2Body") },
    { icon: ICONS.users, title: t("landing.f3Title"), body: t("landing.f3Body") },
    { icon: ICONS.shield, title: t("landing.f4Title"), body: t("landing.f4Body") },
    { icon: ICONS.pulse, title: t("landing.f5Title"), body: t("landing.f5Body") },
    { icon: ICONS.sparkle, title: t("landing.f6Title"), body: t("landing.f6Body") },
    { icon: ICONS.search, title: t("landing.f7Title"), body: t("landing.f7Body") },
    { icon: ICONS.settings, title: t("landing.f8Title"), body: t("landing.f8Body") },
  ];
  const steps = [
    { title: t("landing.s1Title"), body: t("landing.s1Body") },
    { title: t("landing.s2Title"), body: t("landing.s2Body") },
    { title: t("landing.s3Title"), body: t("landing.s3Body") },
    { title: t("landing.s4Title"), body: t("landing.s4Body") },
  ];
  const proofs = [t("landing.proof1"), t("landing.proof2"), t("landing.proof3"), t("landing.proof4")];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/welcome" aria-label="ScopeLock"><Wordmark /></Link>
          <nav aria-label="Landing" className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#features" className="hover:text-slate-900">{t("landing.navFeatures")}</a>
            <a href="#how" className="hover:text-slate-900">{t("landing.navHow")}</a>
            <a href={REPO} className="hover:text-slate-900" rel="noreferrer">GitHub</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className="tap hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 sm:inline-block">{t("auth.login")}</Link>
            <Link to="/register" className="tap rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white shadow-card hover:bg-teal-800">{t("landing.getStarted")}</Link>
          </div>
        </div>
      </header>

      <section className="bg-aurora relative overflow-hidden">
        <div aria-hidden="true" className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-link-strong">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-teal-500" />
              {t("landing.eyebrow")}
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-slate-900 sm:text-6xl">
              {t("landing.titleA")}
              <br />
              <span className="text-gradient">{t("landing.titleB")}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">{t("landing.subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="tap inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-lift hover:bg-teal-800">
                {t("landing.ctaDemo")}
                <Icon d={ICONS.arrow} />
              </Link>
              <a href={REPO} rel="noreferrer" className="tap inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-surface px-5 py-3 text-sm font-semibold text-slate-800 shadow-card hover:border-slate-300">
                <GithubMark />
                {t("landing.ctaGithub")}
              </a>
            </div>
            <ul className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 text-sm text-slate-600">
              {proofs.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Icon d={ICONS.check} className="size-3" /></span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative animate-fade-up [animation-delay:120ms]" aria-hidden="true">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-teal-400/25 via-transparent to-sky-400/25 blur-2xl" />
            <div className="relative rounded-2xl border border-slate-200 bg-surface p-5 shadow-pop sm:p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-slate-500">CHG-014</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {t("landing.mockStatus")}
                </span>
              </div>
              <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{t("landing.mockChange")}</p>
              <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{t("landing.mockTitle")}</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs text-slate-500">{t("landing.mockPrice")}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">+ USD 1,800</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs text-slate-500">{t("landing.mockSchedule")}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">+ 4 days</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {[78, 54, 66].map((w, i) => (
                  <div key={i} className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-500/70" style={{ width: `${w}%` }} /></div>
                ))}
              </div>
              <div className="mt-5 flex gap-2">
                <span className="flex-1 rounded-lg bg-teal-700 px-4 py-2 text-center text-sm font-medium text-white">{t("landing.mockApprove")}</span>
                <span className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-medium text-slate-700">{t("landing.mockReject")}</span>
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                <Icon d={ICONS.shield} className="size-3.5 text-teal-600" />
                {t("landing.mockAudit")}
              </p>
            </div>
            <div className="absolute -bottom-6 right-6 hidden animate-float rounded-xl border border-slate-200 bg-surface px-4 py-3 shadow-lift sm:block">
              <p className="text-xs text-slate-500">Audit chain</p>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><Icon d={ICONS.check} className="size-3.5" /> Verified</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{t("landing.featuresTitle")}</h2>
          <p className="mt-4 text-slate-600">{t("landing.featuresSubtitle")}</p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <li key={f.title} className="lift rounded-2xl border border-slate-200 bg-surface p-5 shadow-card">
              <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200/70">
                <Icon d={f.icon} className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" className="scroll-mt-20 border-y border-slate-200 bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{t("landing.howTitle")}</h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
                <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-800 to-teal-900 px-6 py-14 text-center text-white shadow-pop sm:px-12">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-teal-300/20 blur-3xl" />
          <h2 className="relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{t("landing.ctaTitle")}</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-teal-50/85">{t("landing.ctaBody")}</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className="tap rounded-xl bg-white px-5 py-3 text-sm font-semibold text-teal-900 shadow-lift hover:bg-teal-50">{t("landing.ctaDemo")}</Link>
            <a href={REPO} rel="noreferrer" className="tap inline-flex items-center gap-2 rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"><GithubMark />{t("landing.ctaGithub")}</a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:px-6">
          <p>{t("landing.footerNote")}</p>
          <CreditPill />
        </div>
      </footer>
    </div>
  );
}
