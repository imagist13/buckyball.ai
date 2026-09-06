"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SpinnerGap, CheckCircle, Warning, Trash, Plus, Code } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { StatusBanner } from "@/components/patterns/StatusBanner";

interface WeixinAccount {
  account_id: string;
  user_id: string;
  base_url: string;
  cdn_base_url: string;
  name: string;
  enabled: boolean;
  has_token: boolean;
  last_login_at: string | null;
  created_at: string;
}

export function WeixinBridgeSection() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<WeixinAccount[]>([]);

  // QR Login state
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>("");
  const [qrBridgeError, setQrBridgeError] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/weixin/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const formatToastMessage = useCallback((fallback: string, detail?: string) => {
    return detail ? `${fallback}: ${detail}` : fallback;
  }, []);

  const handleToggleAccount = async (accountId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/settings/weixin/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => null) as
        | { error?: string; account_updated?: boolean }
        | null;

      if (!res.ok) {
        if (data?.account_updated) {
          fetchAccounts();
          showToast({
            type: "warning",
            message: formatToastMessage(t("weixin.accountUpdateSavedRestartFailed"), data.error),
          });
          return;
        }
        showToast({
          type: "error",
          message: data?.error || t("weixin.accountUpdateFailed"),
        });
        return;
      }

      fetchAccounts();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : t("weixin.accountUpdateFailed"),
      });
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      const res = await fetch(`/api/settings/weixin/accounts/${accountId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null) as
        | { error?: string; account_deleted?: boolean }
        | null;

      if (!res.ok) {
        if (data?.account_deleted) {
          setDeleteConfirm(null);
          fetchAccounts();
          showToast({
            type: "warning",
            message: formatToastMessage(t("weixin.accountDeleteSavedRestartFailed"), data.error),
          });
          return;
        }
        showToast({
          type: "error",
          message: data?.error || t("weixin.accountDeleteFailed"),
        });
        return;
      }

      setDeleteConfirm(null);
      fetchAccounts();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : t("weixin.accountDeleteFailed"),
      });
    }
  };

  // ── QR Login Flow ───────────────────────────────────────

  const pollQrStatus = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/settings/weixin/login/wait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json().catch(() => null) as
        | {
          status?: string;
          qr_image?: string;
          error?: string;
          bridge_restart_error?: string;
        }
        | null;
      if (!res.ok) {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setQrStatus("failed");
        setQrBridgeError(null);
        showToast({
          type: "error",
          message: data?.error || t("weixin.qrFailed"),
        });
        return;
      }
      if (!data?.status) return;

      setQrStatus(data.status);
      setQrBridgeError(data.bridge_restart_error || null);

      if (data.qr_image && data.status === "waiting") {
        setQrImage(data.qr_image);
      }

      if (data.status === "confirmed" || data.status === "failed") {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        if (data.status === "confirmed") {
          fetchAccounts();
          if (data.bridge_restart_error) {
            showToast({
              type: "warning",
              message: formatToastMessage(t("weixin.qrConfirmedRestartFailed"), data.bridge_restart_error),
            });
          } else {
            // Auto-close QR panel after success
            setTimeout(() => {
              setQrImage(null);
              setQrSessionId(null);
              setQrStatus("");
              setQrBridgeError(null);
            }, 2000);
          }
        } else if (data.status === "failed" && data.error) {
          showToast({
            type: "error",
            message: data.error,
          });
        }
      }
    } catch { /* ignore */ }
  }, [fetchAccounts, formatToastMessage, t]);

  const startQrLogin = async () => {
    setQrLoading(true);
    setQrStatus("");
    setQrBridgeError(null);
    try {
      const res = await fetch("/api/settings/weixin/login/start", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start QR login");
      const data = await res.json();
      setQrImage(data.qr_image);
      setQrSessionId(data.session_id);
      setQrStatus("waiting");

      // Start polling
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => pollQrStatus(data.session_id), 3000);
    } catch (err) {
      setQrStatus("failed");
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : t("weixin.qrFailed"),
      });
    } finally {
      setQrLoading(false);
    }
  };

  const cancelQrLogin = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setQrImage(null);
    setQrSessionId(null);
    setQrStatus("");
    setQrBridgeError(null);
  };

  // Suppress unused variable warning for qrSessionId
  void qrSessionId;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Risk Warning */}
      <StatusBanner variant="warning" className="text-sm">
        <Warning size={16} className="shrink-0 mr-2 mt-0.5" />
        <span>{t("weixin.riskWarning")}</span>
      </StatusBanner>

      {/* Accounts Section */}
      <SettingsCard
        title={t("weixin.accounts")}
        description={t("weixin.accountsDesc")}
      >
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("weixin.noAccounts")}</p>
        ) : (
          <div className="space-y-2">
            {accounts.map(account => (
              <div
                key={account.account_id}
                className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{account.name || account.account_id}</p>
                  <p className="text-xs text-muted-foreground">
                    {account.enabled ? t("weixin.accountActive") : t("weixin.accountPaused")}
                    {account.has_token ? "" : ` · ${t("weixin.accountExpired")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <Switch
                    checked={account.enabled}
                    onCheckedChange={(checked) => handleToggleAccount(account.account_id, checked)}
                  />
                  {deleteConfirm === account.account_id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteAccount(account.account_id)}
                      >
                        {t("common.delete")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteConfirm(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteConfirm(account.account_id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash size={14} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Account / QR Login */}
        {!qrImage ? (
          <Button
            size="sm"
            onClick={startQrLogin}
            disabled={qrLoading}
            className="mt-3"
          >
            {qrLoading ? (
              <SpinnerGap size={14} className="animate-spin mr-1.5" />
            ) : (
              <Plus size={14} className="mr-1.5" />
            )}
            {t("weixin.addAccount")}
          </Button>
        ) : (
          <div className="mt-3 rounded-md border border-border/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Code size={16} />
                {t("weixin.qrLogin")}
              </h3>
              <Button size="sm" variant="ghost" onClick={cancelQrLogin}>
                {t("common.cancel")}
              </Button>
            </div>

            {/* QR Code Image */}
            <div className="flex justify-center">
              <img
                src={qrImage.startsWith("data:") ? qrImage : qrImage.startsWith("http") ? qrImage : `data:image/png;base64,${qrImage}`}
                alt="WeChat QR Code"
                className="w-48 h-48 rounded-md border border-border/30"
              />
            </div>

            {/* Status */}
            <div className="text-center">
              {qrStatus === "waiting" && (
                <StatusBanner variant="info">
                  <SpinnerGap size={14} className="animate-spin mr-1.5 inline" />
                  {t("weixin.qrWaiting")}
                </StatusBanner>
              )}
              {qrStatus === "scanned" && (
                <StatusBanner variant="info">
                  <CheckCircle size={14} className="mr-1.5 inline text-primary" />
                  {t("weixin.qrScanned")}
                </StatusBanner>
              )}
              {qrStatus === "confirmed" && (
                <StatusBanner variant="success">
                  <CheckCircle size={14} className="mr-1.5 inline" />
                  {t("weixin.qrConfirmed")}
                </StatusBanner>
              )}
              {qrStatus === "expired" && (
                <StatusBanner variant="warning">
                  <Warning size={14} className="mr-1.5 inline" />
                  {t("weixin.qrExpired")}
                </StatusBanner>
              )}
              {qrStatus === "failed" && (
                <StatusBanner variant="error">
                  <Warning size={14} className="mr-1.5 inline" />
                  {t("weixin.qrFailed")}
                </StatusBanner>
              )}
              {qrBridgeError && (
                <StatusBanner variant="warning" className="mt-2">
                  <Warning size={14} className="mr-1.5 inline" />
                  {formatToastMessage(t("weixin.qrConfirmedRestartFailed"), qrBridgeError)}
                </StatusBanner>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Setup Guide */}
      <SettingsCard
        title={t("weixin.setupGuide")}
      >
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>{t("weixin.step1")}</li>
          <li>{t("weixin.step2")}</li>
          <li>{t("weixin.step3")}</li>
          <li>{t("weixin.step4")}</li>
          <li>{t("weixin.step5")}</li>
        </ol>
      </SettingsCard>
    </div>
  );
}
