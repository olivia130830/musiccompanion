"use client";

import { FormEvent, useEffect, useState } from "react";

type LoginMethod = "password" | "otp";
type PasswordIntent = "login" | "signup";
type CodePurpose = "login" | "signup";
type ServiceStatus = "checking" | "ready" | "unavailable";

function getSafeNextPath() {
  if (typeof window === "undefined") return "/";
  const value = new URLSearchParams(window.location.search).get("next");
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

async function requestAuth<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/auth-api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { message?: string | string[] }
    | null;
  if (!response.ok) {
    const message = Array.isArray(payload?.message)
      ? payload.message[0]
      : payload?.message;
    throw new Error(message || "账号服务暂时不可用，请稍后重试。");
  }
  return payload as T;
}

export default function LoginPage() {
  const [method, setMethod] = useState<LoginMethod>("password");
  const [passwordIntent, setPasswordIntent] =
    useState<PasswordIntent>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpPurpose, setOtpPurpose] = useState<CodePurpose>("login");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [serviceStatus, setServiceStatus] =
    useState<ServiceStatus>("checking");

  useEffect(() => {
    const queryError = new URLSearchParams(window.location.search).get("error");
    if (!queryError) return;
    const timer = window.setTimeout(() => setError(queryError), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void requestAuth<{ ok: boolean }>("health")
      .then((result) => setServiceStatus(result.ok ? "ready" : "unavailable"))
      .catch(() => setServiceStatus("unavailable"));
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const clearFeedback = () => {
    setMessage("");
    setError("");
  };

  const finishLogin = () => {
    window.location.assign(getSafeNextPath());
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();

    if (password.length < 8) {
      setError("密码至少需要 8 位。");
      return;
    }

    setIsSubmitting(true);
    try {
      if (passwordIntent === "signup") {
        await requestAuth("auth/send-code", {
          email,
          password,
          purpose: "signup",
        });
        setOtpPurpose("signup");
        setOtpSent(true);
        setOtp("");
        setResendSeconds(60);
        setMethod("otp");
        setMessage("注册验证码已经发送。验证成功后会自动创建账号并登录。");
      } else {
        await requestAuth("auth/password-login", {
          email,
          password,
        });
        finishLogin();
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "暂时无法完成登录。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendOtp = async (purpose: CodePurpose = otpPurpose) => {
    clearFeedback();
    if (!email.trim()) {
      setError("请先输入邮箱地址。 ");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestAuth("auth/send-code", {
        email,
        purpose,
        ...(purpose === "signup" ? { password } : {}),
      });
      setOtpPurpose(purpose);
      setOtpSent(true);
      setResendSeconds(60);
      setMessage(
        purpose === "signup"
          ? "注册验证码已经发送，请查看邮箱。"
          : "验证码已经发送，请查看邮箱。首次使用会自动创建账号。",
      );
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "验证码发送失败。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();

    if (!otpSent) {
      await sendOtp("login");
      return;
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      setError("请输入邮件中的 6 位验证码。 ");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestAuth("auth/verify-code", {
        email,
        code: otp,
        purpose: otpPurpose,
      });
      finishLogin();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "验证码验证失败。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-visual-panel" aria-label="MusicCompanion 品牌介绍">
        <div className="login-visual-glow login-visual-glow-blue" aria-hidden="true" />
        <div className="login-visual-glow login-visual-glow-purple" aria-hidden="true" />

        <div className="login-brand">
          <span className="login-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>MusicCompanion</strong>
            <small>AI LISTENING COMPANION</small>
          </span>
        </div>

        <div className="login-visual-copy">
          <p className="login-eyebrow"><span /> LISTEN · FEEL · SHARE</p>
          <h1>每一次聆听，<br />都有人回应。</h1>
          <p>让 AI 听见旋律、歌词与情绪，也让每个人都能进入属于自己的陪听空间。</p>
          <div className="login-feature-pills" aria-label="主要功能">
            <span>实时陪听</span>
            <span>歌词交流</span>
            <span>专属记录</span>
          </div>
        </div>

        <div className="login-music-art" aria-hidden="true">
          <div className="login-orbit login-orbit-one" />
          <div className="login-orbit login-orbit-two" />
          <div className="login-record">
            <span className="login-record-groove" />
            <span className="login-record-label">M</span>
          </div>
          <div className="login-waveform">
            {[18, 34, 54, 28, 66, 44, 78, 48, 32, 58, 38, 20].map((height, index) => (
              <span key={`${height}-${index}`} style={{ height }} />
            ))}
          </div>
          <span className="login-art-note login-art-note-one">♪</span>
          <span className="login-art-note login-art-note-two">♫</span>
        </div>

        <p className="login-visual-footer"><span /> YOUR MUSIC · YOUR MOMENTS · YOUR COMPANION</p>
      </section>

      <section className="login-form-panel">
        <div className="login-mobile-brand">MusicCompanion</div>
        <div className="login-card">
          <p className="login-form-eyebrow">WELCOME TO MUSICCOMPANION</p>
          <h2>继续一起听</h2>
          <p className="login-form-subtitle">登录你的账号，回到音乐正在发生的地方。</p>

          <div className="login-tabs" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              aria-selected={method === "password"}
              className={method === "password" ? "login-tab-active" : ""}
              onClick={() => {
                setMethod("password");
                setOtpSent(false);
                setOtpPurpose("login");
                clearFeedback();
              }}
            >
              密码登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "otp"}
              className={method === "otp" ? "login-tab-active" : ""}
              onClick={() => {
                setMethod("otp");
                setOtpSent(false);
                setOtpPurpose("login");
                setOtp("");
                clearFeedback();
              }}
            >
              验证码登录
            </button>
          </div>

          {method === "password" ? (
            <form className="login-form" onSubmit={handlePasswordSubmit}>
              <label htmlFor="login-email">邮箱</label>
              <div className="login-input-wrap">
                <span aria-hidden="true">@</span>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </div>

              <label htmlFor="login-password">密码</label>
              <div className="login-input-wrap">
                <span aria-hidden="true">◇</span>
                <input
                  id="login-password"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete={passwordIntent === "signup" ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位密码"
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? "隐藏" : "显示"}
                </button>
              </div>

              <button className="login-primary-button" disabled={isSubmitting} type="submit">
                {isSubmitting
                  ? "请稍候…"
                  : passwordIntent === "signup"
                    ? "创建账号"
                    : "登录并继续"}
                <span aria-hidden="true">→</span>
              </button>

              <button
                type="button"
                className="login-intent-switch"
                onClick={() => {
                  setPasswordIntent((current) => current === "login" ? "signup" : "login");
                  clearFeedback();
                }}
              >
                {passwordIntent === "login" ? "还没有账号？创建一个" : "已经有账号？返回登录"}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleOtpSubmit}>
              <label htmlFor="otp-email">邮箱</label>
              <div className="login-input-wrap">
                <span aria-hidden="true">@</span>
                <input
                  id="otp-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={otpSent}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
                {otpSent && (
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => {
                      setOtpSent(false);
                      setOtp("");
                      clearFeedback();
                    }}
                  >
                    修改
                  </button>
                )}
              </div>

              {otpSent && (
                <>
                  <label htmlFor="login-otp">邮箱验证码</label>
                  <div className="login-input-wrap login-otp-wrap">
                    <span aria-hidden="true">#</span>
                    <input
                      id="login-otp"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      required
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                      placeholder="输入 6 位验证码"
                    />
                    <button
                      type="button"
                      className="login-password-toggle"
                      disabled={resendSeconds > 0 || isSubmitting}
                      onClick={() => void sendOtp()}
                    >
                      {resendSeconds > 0 ? `${resendSeconds}s` : "重发"}
                    </button>
                  </div>
                </>
              )}

              <button className="login-primary-button" disabled={isSubmitting} type="submit">
                {isSubmitting ? "请稍候…" : otpSent ? "验证并登录" : "发送验证码"}
                <span aria-hidden="true">→</span>
              </button>
            </form>
          )}

          {message && <p className="login-feedback login-success" role="status">{message}</p>}
          {error && <p className="login-feedback login-error" role="alert">{error}</p>}
          {serviceStatus === "unavailable" && (
            <p className="login-feedback login-setup" role="status">
              页面已经就绪。请配置 PostgreSQL 与 Gmail SMTP 后启用账号服务。
            </p>
          )}

          <div className="login-security-note">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>你的聆听空间，只属于你</strong>
              <p>登录状态使用安全 Cookie 保存，密码只会以加盐哈希形式存储。</p>
            </div>
          </div>
        </div>
        <footer className="login-footer">© 2026 MusicCompanion · 音乐发生的时候，也有人听见</footer>
      </section>
    </main>
  );
}
