import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Sprout, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/AuthContext";
import { FcGoogle } from "react-icons/fc";
import { FaMicrosoft, FaFacebook } from "react-icons/fa";
import { getSocialProviderConfigs, loginWithSocial } from "@/auth/oauthService";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function FloatingField({ label, value, onChange, type = "text", autoComplete, error, name }) {
  const active = Boolean(value);

  return (
    <div className="relative">
      <Input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className={`h-12 rounded-xl pt-5 ${error ? "border-red-400 focus-visible:ring-red-200" : ""}`}
      />
      <label
        className={`absolute left-3 transition-all pointer-events-none ${
          active ? "top-1 text-xs text-slate-600" : "top-3 text-sm text-slate-400"
        }`}
      >
        {label}
      </label>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function SocialButton({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-violet-200/70 bg-white/70 backdrop-blur-lg transition-all hover:bg-violet-50/70 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex items-center justify-center w-5">{icon}</span>
      <span className="font-medium text-slate-900">{label}</span>
    </button>
  );
}

export default function Login() {
  const { signInWithEmail, signInWithSocial, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState("");
  const [error, setError] = useState("");

  const nextPath = useMemo(() => {
    const raw = decodeURIComponent(params.get("next") || "/");
    if (!raw) return "/";
    if (raw.startsWith("/")) return raw;
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return "/";
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      return "/";
    }
  }, [params]);
  const resetSuccess = params.get("reset") === "success";
  const socialProviders = useMemo(() => getSocialProviderConfigs().filter((provider) => provider.enabled), []);

  useEffect(() => {
    if (isAuthenticated) navigate(nextPath, { replace: true });
  }, [isAuthenticated, navigate, nextPath]);

  const emailError = email && !emailRegex.test(email) ? "Enter a valid email address." : "";
  const canSubmit = emailRegex.test(email) && password.length > 0 && !loading && !socialLoading;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    setLoading(true);
    try {
      await signInWithEmail({ email, password, remember });
      navigate(nextPath, { replace: true });
    } catch (signInError) {
      setError(signInError?.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  };

  const onSocialLogin = async (provider) => {
    setError("");
    setSocialLoading(provider);
    try {
      const result = await loginWithSocial(provider);
      await signInWithSocial({ ...result, remember });
      navigate(nextPath, { replace: true });
    } catch (socialError) {
      setError(socialError?.message || "Social sign-in failed.");
    } finally {
      setSocialLoading("");
    }
  };

  return (
    <div className="min-h-screen bg-transparent grid md:grid-cols-2">
      <div className="hidden md:flex items-center justify-center bg-gradient-to-b from-[#2e1065] via-[#4c1d95] to-[#312e81] p-12 text-white">
        <div className="max-w-md text-center space-y-8">
          <div className="mx-auto bg-white w-16 h-16 rounded-xl flex items-center justify-center shadow">
            <Sprout className="text-[#1f4d9b]" />
          </div>
          <h1 className="text-5xl font-bold leading-tight">
            Welcome back.
            <br />
            Your farm awaits.
          </h1>
          <p className="text-lg text-violet-100">
            Securely access Aerovanta to manage diagnostics, schedules, and operations in one place.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md rounded-3xl border border-white/75 bg-white/75 p-10 shadow-[0_20px_45px_rgba(109,40,217,0.18)] backdrop-blur-xl space-y-6">
          <div className="space-y-1">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Welcome to Aerovanta</h2>
            <p className="text-slate-500 text-sm">Sign in to continue</p>
          </div>

          {resetSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Password updated successfully. Please sign in with your new password.
            </div>
          ) : null}

          {socialProviders.length > 0 ? (
            <div className="space-y-2">
              {socialProviders.some((provider) => provider.key === "google") ? (
                <SocialButton
                  icon={<FcGoogle size={20} />}
                  label="Continue with Google"
                  onClick={() => onSocialLogin("google")}
                  disabled={Boolean(socialLoading)}
                />
              ) : null}
              {socialProviders.some((provider) => provider.key === "microsoft") ? (
                <SocialButton
                  icon={<FaMicrosoft size={17} className="text-[#5E5E5E]" />}
                  label="Continue with Microsoft"
                  onClick={() => onSocialLogin("microsoft")}
                  disabled={Boolean(socialLoading)}
                />
              ) : null}
              {socialProviders.some((provider) => provider.key === "facebook") ? (
                <SocialButton
                  icon={<FaFacebook size={17} className="text-[#1877F2]" />}
                  label="Continue with Facebook"
                  onClick={() => onSocialLogin("facebook")}
                  disabled={Boolean(socialLoading)}
                />
              ) : null}
              {socialLoading ? (
                <p className="text-xs text-slate-500 text-center">
                  Connecting to {socialLoading}...
                </p>
              ) : null}
            </div>
          ) : null}

          {socialProviders.length > 0 ? (
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <div className="flex-1 h-px bg-slate-200" />
              OR
              <div className="flex-1 h-px bg-slate-200" />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4">
            <FloatingField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={emailError}
            />

            <FloatingField
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={remember}
                  disabled={Boolean(socialLoading)}
                  onChange={() => setRemember((value) => !value)}
                />
                Remember me
              </label>

              <Link to="/forgot-password" className="text-sm text-slate-500 transition hover:text-violet-700">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-12 w-full rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 text-white font-semibold shadow-[0_8px_22px_rgba(124,58,237,0.32)] transition-all hover:brightness-110 disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </Button>

            {error ? <p className="text-sm text-red-600 text-center">{error}</p> : null}
          </form>

          <p className="text-sm text-slate-500 text-center">
            New to Aerovanta?{" "}
            <Link className="font-semibold text-violet-600 hover:text-violet-700" to="/signup">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
