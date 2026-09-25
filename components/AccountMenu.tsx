"use client";

import { useEffect, useState } from "react";

import type { AppLanguage } from "@/lib/i18n";

type AccountMenuProps = {
  language: AppLanguage;
};

export default function AccountMenu({ language }: AccountMenuProps) {
  const [email, setEmail] = useState("");

  useEffect(() => {
    void fetch("/auth-api/auth/session", {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { user?: { email?: string } } | null) => {
        setEmail(result?.user?.email ?? "");
      })
      .catch(() => setEmail(""));
  }, []);

  const handleSignOut = async () => {
    await fetch("/auth-api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    window.location.assign("/login");
  };

  return (
    <div className="account-menu" aria-label={language === "zh" ? "账号" : "Account"}>
      {email && <span className="account-chip" title={email}>{email}</span>}
      <button className="account-signout" type="button" onClick={() => void handleSignOut()}>
        {language === "zh" ? "退出" : "Sign out"}
      </button>
    </div>
  );
}
