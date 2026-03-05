import { useCallback, useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";

export default function DeviceSessions() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const formatDate = (value) => {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  };

  const load = useCallback(async () => {
    if (!user?.email) {
      setSessions([]);
      setErrorMessage("");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const data = await appClient.enterprise.listSessions(user.email);
      setSessions(Array.isArray(data) ? data : []);
    } catch (error) {
      setErrorMessage(error?.message || "Failed to load active sessions.");
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    load();
  }, [load]);

  const logoutOthers = async () => {
    if (!user?.email) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await appClient.enterprise.logoutOtherDevices(user.email);
      await load();
    } catch (error) {
      setErrorMessage(error?.message || "Failed to log out other devices.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/75 bg-white/65 p-6 space-y-4 backdrop-blur-xl shadow-[0_10px_30px_rgba(124,58,237,0.12)]">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Active Devices</h3>
        <Button
          variant="outline"
          onClick={logoutOthers}
          disabled={loading || sessions.length <= 1}
        >
          {loading ? "Working..." : "Log out other devices"}
        </Button>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>{errorMessage}</span>
          <Button type="button" variant="outline" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading && sessions.length === 0 ? (
        <p className="text-sm text-slate-500">Loading sessions...</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No session data yet.</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border p-4 text-sm ${
                s.is_current_device ? "border-violet-200 bg-violet-50/60" : "border-white/70 bg-white/60"
              }`}
            >
              <div className="font-medium text-slate-900 flex items-center justify-between">
                <span>{s.device_info?.platform || "Device"}</span>
                {s.is_current_session ? (
                  <span className="text-xs text-emerald-700 font-semibold">Current session</span>
                ) : s.is_current_device ? (
                  <span className="text-xs text-emerald-700 font-semibold">This device</span>
                ) : (
                  <span className="text-xs text-slate-500">Other</span>
                )}
              </div>
              <div className="text-slate-500 mt-1 break-words">
                {s.device_info?.userAgent || "Unknown user agent"}
              </div>
              <div className="text-xs text-slate-400 mt-2">
                Last active: {formatDate(s.last_active)}
              </div>
              {s.expires_at ? (
                <div className="text-xs text-slate-400 mt-1">
                  Expires: {formatDate(s.expires_at)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
