"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SpinnerGap, CheckCircle, Warning } from "@/components/ui/icon";
import { SaveButton } from "@/components/ui/save-button";
import { useTranslation } from "@/hooks/useTranslation";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";

interface QqBridgeSettings {
  bridge_qq_app_id: string;
  bridge_qq_app_secret: string;
  bridge_qq_allowed_users: string;
  bridge_qq_image_enabled: string;
  bridge_qq_max_image_size: string;
}

const DEFAULT_SETTINGS: QqBridgeSettings = {
  bridge_qq_app_id: "",
  bridge_qq_app_secret: "",
  bridge_qq_allowed_users: "",
  bridge_qq_image_enabled: "true",
  bridge_qq_max_image_size: "20",
};

export function QqBridgeSection() {
  const [, setSettings] = useState<QqBridgeSettings>(DEFAULT_SETTINGS);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [allowedUsers, setAllowedUsers] = useState("");
  const [imageEnabled, setImageEnabled] = useState(true);
  const [maxImageSize, setMaxImageSize] = useState("20");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const { t } = useTranslation();

  // Three save groups → three snapshots. appSecret is server-masked as
  // "***…" — see handleSaveCredentials, only sent when the user types a
  // real value — so the credentials snapshot mirrors that mask.
  const [savedCredentials, setSavedCredentials] = useState({
    appId: "",
    appSecret: "",
  });
  const [savedAllowedUsers, setSavedAllowedUsers] = useState("");
  const [savedImageSettings, setSavedImageSettings] = useState({
    imageEnabled: true,
    maxImageSize: "20",
  });
  const credentialsDirty =
    appId !== savedCredentials.appId ||
    appSecret !== savedCredentials.appSecret;
  const allowedUsersDirty = allowedUsers !== savedAllowedUsers;
  const imageSettingsDirty =
    imageEnabled !== savedImageSettings.imageEnabled ||
    maxImageSize !== savedImageSettings.maxImageSize;

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/qq");
      if (res.ok) {
        const data = await res.json();
        const s = { ...DEFAULT_SETTINGS, ...data.settings };
        setSettings(s);
        setAppId(s.bridge_qq_app_id);
        setAppSecret(s.bridge_qq_app_secret);
        setAllowedUsers(s.bridge_qq_allowed_users);
        const img = s.bridge_qq_image_enabled !== "false";
        const max = s.bridge_qq_max_image_size || "20";
        setImageEnabled(img);
        setMaxImageSize(max);
        setSavedCredentials({
          appId: s.bridge_qq_app_id,
          appSecret: s.bridge_qq_app_secret,
        });
        setSavedAllowedUsers(s.bridge_qq_allowed_users);
        setSavedImageSettings({ imageEnabled: img, maxImageSize: max });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async (
    updates: Partial<QqBridgeSettings>,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/qq", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: updates }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...updates }));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCredentials = async () => {
    const updates: Partial<QqBridgeSettings> = {
      bridge_qq_app_id: appId,
    };
    // Three-way secret handling: mask kept = omit / empty = explicit
    // clear / real value = send. Empty case lets the user remove a
    // saved secret via the UI, which the old `if (secret && ...)`
    // gate silently dropped.
    if (appSecret === "") {
      updates.bridge_qq_app_secret = "";
    } else if (!appSecret.startsWith("***")) {
      updates.bridge_qq_app_secret = appSecret;
    }
    const ok = await saveSettings(updates);
    if (ok) {
      // Baseline from current form state, not updates: when the mask
      // stayed untouched `updates.bridge_qq_app_secret` is undefined,
      // and using that to rebuild the snapshot would silently drop
      // the mask and leave the button stuck on "保存".
      setSavedCredentials({ appId, appSecret });
    }
  };

  const handleSaveAllowedUsers = async () => {
    const ok = await saveSettings({ bridge_qq_allowed_users: allowedUsers });
    if (ok) {
      setSavedAllowedUsers(allowedUsers);
    }
  };

  const handleSaveImageSettings = async () => {
    const ok = await saveSettings({
      bridge_qq_image_enabled: imageEnabled ? "true" : "false",
      bridge_qq_max_image_size: maxImageSize,
    });
    if (ok) {
      setSavedImageSettings({ imageEnabled, maxImageSize });
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      if (!appId) {
        setVerifyResult({
          ok: false,
          message: t("qq.enterCredentialsFirst"),
        });
        return;
      }

      const res = await fetch("/api/settings/qq/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
        }),
      });
      const data = await res.json();

      if (data.verified) {
        setVerifyResult({
          ok: true,
          message: t("qq.verified"),
        });
      } else {
        setVerifyResult({
          ok: false,
          message: data.error || t("qq.verifyFailed"),
        });
      }
    } catch {
      setVerifyResult({ ok: false, message: t("qq.verifyFailed") });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* App Credentials */}
      <SettingsCard
        title={t("qq.credentials")}
        description={t("qq.credentialsDesc")}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("qq.appId")}
            </label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="xxxxxxxxxx"
              className="font-mono text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("qq.appSecret")}
            </label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SaveButton
            dirty={credentialsDirty}
            saving={saving}
            onClick={handleSaveCredentials}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleVerify}
            disabled={verifying || !appId}
          >
            {verifying ? (
              <SpinnerGap
                size={14}
                className="animate-spin mr-1.5"
              />
            ) : null}
            {t("qq.verify")}
          </Button>
        </div>

        {verifyResult && (
          <StatusBanner
            variant={verifyResult.ok ? "success" : "error"}
            icon={verifyResult.ok ? <CheckCircle size={16} className="shrink-0" /> : <Warning size={16} className="shrink-0" />}
          >
            {verifyResult.message}
          </StatusBanner>
        )}
      </SettingsCard>

      {/* Allowed Users */}
      <SettingsCard
        title={t("qq.allowedUsers")}
        description={t("qq.allowedUsersDesc")}
      >
        <div>
          <Input
            value={allowedUsers}
            onChange={(e) => setAllowedUsers(e.target.value)}
            placeholder="user_openid_1, user_openid_2"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("qq.allowedUsersHint")}
          </p>
        </div>

        <SaveButton
          dirty={allowedUsersDirty}
          saving={saving}
          onClick={handleSaveAllowedUsers}
        />
      </SettingsCard>

      {/* Image Settings */}
      <SettingsCard
        title={t("qq.imageSettings")}
        description={t("qq.imageSettingsDesc")}
      >
        <div className="space-y-3">
          <FieldRow
            label={t("qq.imageEnabled")}
            description={t("qq.imageEnabledDesc")}
          >
            <Switch
              checked={imageEnabled}
              onCheckedChange={setImageEnabled}
            />
          </FieldRow>

          {imageEnabled && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t("qq.maxImageSize")}
              </label>
              <Input
                type="number"
                value={maxImageSize}
                onChange={(e) => setMaxImageSize(e.target.value)}
                placeholder="20"
                className="w-32 text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("qq.maxImageSizeHint")}
              </p>
            </div>
          )}
        </div>

        <SaveButton
          dirty={imageSettingsDirty}
          saving={saving}
          onClick={handleSaveImageSettings}
        />
      </SettingsCard>

      {/* Setup Guide */}
      <SettingsCard title={t("qq.setupGuide")}>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
          <li>{t("qq.step1")}</li>
          <li>{t("qq.step2")}</li>
          <li>{t("qq.step3")}</li>
          <li>{t("qq.step4")}</li>
          <li>{t("qq.step5")}</li>
        </ol>
      </SettingsCard>
    </div>
  );
}
