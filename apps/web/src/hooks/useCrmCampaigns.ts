import { useCallback, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { CampaignSegment } from "@/lib/crm/segments";

export type CampaignSourceType = "event" | "promotion";

export type SendCampaignPayload = {
  restaurantId: string;
  sourceType: CampaignSourceType;
  sourceId: string;
  targetSegments: CampaignSegment[];
  title: string;
  body: string;
};

export type SendCampaignResult = {
  campaignId: string;
  targetCount: number;
  sentCount: number;
  skippedCount: number;
};

type SendCampaignRpcResult = {
  campaign_id?: unknown;
  target_count?: unknown;
  sent_count?: unknown;
  skipped_count?: unknown;
};

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function adaptCampaignResult(value: unknown): SendCampaignResult {
  const row = (value ?? {}) as SendCampaignRpcResult;
  return {
    campaignId: typeof row.campaign_id === "string" ? row.campaign_id : "",
    targetCount: numberField(row.target_count),
    sentCount: numberField(row.sent_count),
    skippedCount: numberField(row.skipped_count),
  };
}

export function useCrmCampaigns() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendCampaign = useCallback(async (payload: SendCampaignPayload): Promise<SendCampaignResult | null> => {
    if (!isSupabaseConfigured()) {
      const err = new Error("Supabase is not configured.");
      setError(err);
      return null;
    }

    setSending(true);
    setError(null);
    try {
      const client = getSupabaseBrowserClient();
      const { data, error: rpcError } = await client.rpc("send_crm_campaign", {
        p_restaurant_id: payload.restaurantId,
        p_source_type: payload.sourceType,
        p_source_id: payload.sourceId,
        p_target_segments: payload.targetSegments,
        p_title: payload.title,
        p_body: payload.body,
      });

      if (rpcError) {
        const err = new Error(rpcError.message);
        setError(err);
        return null;
      }

      return adaptCampaignResult(data);
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error("Could not send campaign.");
      setError(err);
      return null;
    } finally {
      setSending(false);
    }
  }, []);

  return { sending, error, sendCampaign };
}
