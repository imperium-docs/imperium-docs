import type { ComponentProps } from "react";
import React, { useEffect, useMemo, useState } from "react";
import { CloseSvg } from "./Svgs";
import { useRouter } from "next/router";
import { useBoundStore } from "~/hooks/useBoundStore";
import { buildAuthUrl, sendAuthEvent } from "~/utils/authApi";

const loginHero = new URL("../assets/longin-bg4.webp", import.meta.url).href;

export const GoogleLogoSvg = (props: ComponentProps<"svg">) => {
  return (
    <svg viewBox="0 0 48 48" {...props}>
      <g>
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        ></path>
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        ></path>
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        ></path>
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        ></path>
        <path fill="none" d="M0 0h48v48H0z"></path>
      </g>
    </svg>
  );
};

export const GitHubLogoSvg = (props: ComponentProps<"svg">) => {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M12 2c-5.52 0-10 4.6-10 10.27 0 4.53 2.86 8.37 6.84 9.72.5.1.68-.22.68-.5 0-.24-.01-.89-.01-1.74-2.78.63-3.36-1.38-3.36-1.38-.46-1.2-1.12-1.52-1.12-1.52-.9-.65.07-.64.07-.64 1 .07 1.52 1.07 1.52 1.07.9 1.6 2.36 1.13 2.94.86.09-.67.35-1.13.63-1.4-2.22-.26-4.56-1.15-4.56-5.12 0-1.13.39-2.06 1.03-2.79-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.06.8-.23 1.66-.35 2.52-.35.86 0 1.72.12 2.52.35 1.9-1.34 2.75-1.06 2.75-1.06.56 1.41.21 2.45.1 2.71.64.73 1.03 1.66 1.03 2.79 0 3.98-2.34 4.86-4.57 5.11.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .28.18.6.69.5C19.14 20.64 22 16.8 22 12.27 22 6.6 17.52 2 12 2z"
      />
    </svg>
  );
};

export const AppleLogoSvg = (props: ComponentProps<"svg">) => {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M16.72 13.39c.02 2.2 1.96 2.93 1.98 2.94-.02.05-.31 1.07-1.02 2.12-.62.92-1.27 1.83-2.3 1.85-1.01.02-1.33-.6-2.49-.6-1.16 0-1.52.58-2.47.62-1 .04-1.76-.97-2.39-1.88-1.29-1.87-2.28-5.29-.95-7.6.66-1.15 1.85-1.88 3.14-1.9.98-.02 1.9.67 2.49.67.59 0 1.69-.83 2.84-.71.48.02 1.83.2 2.7 1.53-.07.04-1.61.96-1.6 2.96zM14.82 5.1c.52-.64.87-1.53.78-2.42-.75.03-1.65.52-2.18 1.16-.48.56-.9 1.46-.78 2.32.84.07 1.66-.43 2.18-1.06z"
      />
    </svg>
  );
};

export const MetaLogoSvg = (props: ComponentProps<"svg">) => {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M19.5 6.5c-2.1 0-3.5 1.7-4.9 3.9C13.4 8.3 12 6.5 9.9 6.5 6.8 6.5 4.5 9.3 4.5 13c0 3.7 1.7 7.5 4 7.5 1.6 0 2.7-2 4-4.4 1.2 2.4 2.3 4.4 4 4.4 2.3 0 4-3.8 4-7.5s-2.3-6.5-5-6.5zm-7 10.6c-1.1 2-2 3.5-3 3.5-1.4 0-2.7-3-2.7-7.6 0-2.7 1.4-4.7 3.1-4.7 1.5 0 2.6 1.4 3.8 3.6-0.7 1.3-1.3 2.6-1.2 5.2zm4.9 3.5c-1 0-1.9-1.5-3-3.5 0-2.6-.5-3.9-1.2-5.2 1.2-2.2 2.3-3.6 3.8-3.6 1.7 0 3.1 2 3.1 4.7 0 4.6-1.3 7.6-2.7 7.6z"
      />
    </svg>
  );
};

const QrPreview = () => {
  return (
    <svg viewBox="0 0 100 100" className="login-qr-svg" aria-hidden>
      <rect width="100" height="100" rx="12" fill="white" />
      <rect x="8" y="8" width="28" height="28" fill="#111" />
      <rect x="14" y="14" width="16" height="16" fill="white" />
      <rect x="18" y="18" width="8" height="8" fill="#111" />
      <rect x="64" y="8" width="28" height="28" fill="#111" />
      <rect x="70" y="14" width="16" height="16" fill="white" />
      <rect x="74" y="18" width="8" height="8" fill="#111" />
      <rect x="8" y="64" width="28" height="28" fill="#111" />
      <rect x="14" y="70" width="16" height="16" fill="white" />
      <rect x="18" y="74" width="8" height="8" fill="#111" />
      <rect x="46" y="46" width="10" height="10" fill="#111" />
      <rect x="58" y="52" width="8" height="8" fill="#111" />
      <rect x="44" y="66" width="12" height="12" fill="#111" />
      <rect x="70" y="66" width="10" height="10" fill="#111" />
      <rect x="54" y="80" width="6" height="6" fill="#111" />
      <rect x="38" y="82" width="6" height="6" fill="#111" />
    </svg>
  );
};

export type LoginScreenState = "HIDDEN" | "LOGIN" | "SIGNUP" | "COLLECT_EMAIL";

export const useLoginScreen = () => {
  const router = useRouter();
  const loggedIn = useBoundStore((x) => x.loggedIn);
  const queryState: LoginScreenState = (() => {
    if (loggedIn) return "HIDDEN";
    if ("collect-email" in router.query || "collect_email" in router.query) {
      return "COLLECT_EMAIL";
    }
    if ("login" in router.query) return "LOGIN";
    if ("sign-up" in router.query) return "SIGNUP";
    return "HIDDEN";
  })();
  const [loginScreenState, setLoginScreenState] = React.useState(queryState);
  useEffect(() => setLoginScreenState(queryState), [queryState]);
  return { loginScreenState, setLoginScreenState };
};

export const LoginScreen = ({
  loginScreenState,
  setLoginScreenState,
}: {
  loginScreenState: LoginScreenState;
  setLoginScreenState: React.Dispatch<React.SetStateAction<LoginScreenState>>;
}) => {
  const loggedIn = useBoundStore((x) => x.loggedIn);
  const router = useRouter();
  const [showMore, setShowMore] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  const collectEmailToken = useMemo(() => {
    const raw =
      router.query["collect-email"] ?? router.query["collect_email"] ?? null;
    if (Array.isArray(raw)) return raw[0];
    return raw;
  }, [router.query]);
  const isCollectEmail = loginScreenState === "COLLECT_EMAIL";

  useEffect(() => {
    if (loginScreenState !== "HIDDEN" && loggedIn) {
      setLoginScreenState("HIDDEN");
    }
  }, [loginScreenState, loggedIn, setLoginScreenState]);

  useEffect(() => {
    document.body.classList.toggle(
      "login-open",
      loginScreenState !== "HIDDEN",
    );
    return () => {
      document.body.classList.remove("login-open");
    };
  }, [loginScreenState]);

  useEffect(() => {
    if (loginScreenState !== "HIDDEN") {
      void sendAuthEvent("login_view");
    }
  }, [loginScreenState]);

  const enableMeta = import.meta.env.VITE_AUTH_ENABLE_META !== "false";
  const enableGitHub = import.meta.env.VITE_AUTH_ENABLE_GITHUB !== "false";

  const primaryProviders = [
    {
      key: "apple",
      name: "Apple",
      href: buildAuthUrl("/auth/apple"),
      Icon: AppleLogoSvg,
      variant: "solid",
    },
    {
      key: "google",
      name: "Google",
      href: buildAuthUrl("/auth/google"),
      Icon: GoogleLogoSvg,
      variant: "outline",
    },
  ] as const;

  const moreProviders = [
    enableMeta
      ? {
          key: "meta",
          name: "Meta",
          href: buildAuthUrl("/auth/meta"),
          Icon: MetaLogoSvg,
          variant: "outline",
        }
      : null,
    enableGitHub
      ? {
          key: "github",
          name: "GitHub",
          href: buildAuthUrl("/auth/github"),
          Icon: GitHubLogoSvg,
          variant: "outline",
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    name: string;
    href: string;
    Icon: typeof MetaLogoSvg;
    variant: "solid" | "outline";
  }>;

  const heading =
    loginScreenState === "COLLECT_EMAIL"
      ? "Confirme seu email"
      : loginScreenState === "SIGNUP"
        ? "Crie sua conta"
        : "Bem-vindo de volta";
  const subheading =
    loginScreenState === "COLLECT_EMAIL"
      ? "Para concluir o acesso, informe um email valido."
      : loginScreenState === "SIGNUP"
        ? "Entre com um provedor para criar seu acesso."
        : "Escolha um provedor para continuar com seguranca.";

  const handleCollectEmail = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setEmailError("");
    if (!collectEmailToken) {
      setEmailError("Seu token expirou. Tente novamente.");
      return;
    }
    if (!emailValue.trim()) {
      setEmailError("Informe um email valido.");
      return;
    }
    setEmailSubmitting(true);
    try {
      const response = await fetch(buildAuthUrl("/auth/collect-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: collectEmailToken, email: emailValue }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message ?? "Nao foi possivel concluir o login.");
      }
      const data = await response.json().catch(() => ({}));
      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl as string;
      } else {
        window.location.href = "/";
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Nao foi possivel concluir.";
      setEmailError(message);
    } finally {
      setEmailSubmitting(false);
    }
  };

  return (
    <article
      className={[
        "login-screen",
        loginScreenState === "HIDDEN" ? "is-hidden" : "is-visible",
      ].join(" ")}
      aria-hidden={loginScreenState === "HIDDEN"}
    >
      <button
        className="login-close"
        onClick={() => setLoginScreenState("HIDDEN")}
      >
        <CloseSvg />
        <span className="sr-only">Close</span>
      </button>

      <section className="login-left">
        <div className="login-brand">
          <span className="login-mark" aria-hidden></span>
          <span className="login-brand-name">IMPERIUM</span>
        </div>

        <div className="login-copy">
          <h1>{heading}</h1>
          <p>{subheading}</p>
        </div>

        {!isCollectEmail && (
          <>
            <div className="login-provider-list">
              {primaryProviders.map(({ key, name, href, Icon, variant }) => (
                <a
                  key={key}
                  href={href}
                  onClick={() => sendAuthEvent("oauth_click", key)}
                  className={[
                    "login-provider",
                    variant === "solid" ? "is-solid" : "is-outline",
                  ].join(" ")}
                >
                  <Icon className="login-provider-icon" />
                  Continuar com {name}
                </a>
              ))}
            </div>

            {moreProviders.length > 0 && (
              <div className="login-more">
                <button
                  type="button"
                  className="login-more-toggle"
                  onClick={() => setShowMore((value) => !value)}
                  aria-expanded={showMore}
                >
                  Mais opcoes
                  <span className="login-more-caret">
                    {showMore ? "-" : "+"}
                  </span>
                </button>
                {showMore && (
                  <div className="login-more-content">
                    {moreProviders.map(({ key, name, href, Icon, variant }) => (
                      <a
                        key={key}
                        href={href}
                        onClick={() => sendAuthEvent("oauth_click", key)}
                        className={[
                          "login-provider",
                          variant === "solid" ? "is-solid" : "is-outline",
                        ].join(" ")}
                      >
                        <Icon className="login-provider-icon" />
                        Continuar com {name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {isCollectEmail && (
          <form className="login-collect" onSubmit={handleCollectEmail}>
            <label className="login-collect-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={emailValue}
              onChange={(event) => setEmailValue(event.target.value)}
              className="login-collect-input"
              placeholder="nome@exemplo.com"
              required
            />
            {emailError && <div className="login-error">{emailError}</div>}
            <button
              type="submit"
              className="login-collect-submit"
              disabled={emailSubmitting}
            >
              {emailSubmitting ? "Enviando..." : "Confirmar email"}
            </button>
          </form>
        )}

        {!isCollectEmail && (
          <div className="login-qr">
            <QrPreview />
            <div>
              <div className="login-qr-title">Login via QR</div>
              <p className="login-qr-text">
                Escaneie para entrar com seu dispositivo.
              </p>
            </div>
          </div>
        )}

        {!isCollectEmail && (
          <div className="login-footer">
            <span>
              {loginScreenState === "SIGNUP"
                ? "Ja tem conta?"
                : "Ainda nao possui conta?"}
            </span>
            <button
              type="button"
              onClick={() =>
                setLoginScreenState((state) =>
                  state === "LOGIN" ? "SIGNUP" : "LOGIN",
                )
              }
            >
              {loginScreenState === "SIGNUP" ? "Entrar" : "Criar conta"}
            </button>
          </div>
        )}
      </section>

      <section className="login-right">
        <div
          className="login-hero"
          style={{ backgroundImage: `url(${loginHero})` }}
        >
          <div className="login-hero-overlay"></div>
          <div className="login-hero-caption"></div>
        </div>
      </section>
    </article>
  );
};

