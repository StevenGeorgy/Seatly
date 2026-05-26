import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const schema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(200),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .refine((v) => !v || v.length >= 7, "Phone number looks too short"),
  restaurant_name: z.string().trim().max(200).optional(),
  message: z.string().trim().max(1000).optional(),
});

export type BookDemoFormValues = z.infer<typeof schema>;

type BookDemoFormProps = {
  onSuccess: (values: BookDemoFormValues) => void;
};

export function BookDemoForm({ onSuccess }: BookDemoFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BookDemoFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      restaurant_name: "",
      message: "",
    },
  });

  const messageLen = watch("message")?.length ?? 0;

  async function onSubmit(values: BookDemoFormValues) {
    setSubmitError(null);
    if (!isSupabaseConfigured()) {
      setSubmitError("Form is offline. Email hello@cenaiva.com instead.");
      return;
    }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.functions.invoke("submit-demo-request", {
        body: {
          name: values.name,
          email: values.email,
          phone: values.phone || null,
          restaurant_name: values.restaurant_name || null,
          message: values.message || null,
        },
      });
      if (error) {
        setSubmitError(error.message || "Something went wrong. Please try again.");
        return;
      }
      onSuccess(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="demo-name" className="text-sm font-medium text-white">
            Your name <span className="text-gold">*</span>
          </Label>
          <Input
            id="demo-name"
            autoComplete="name"
            {...register("name")}
            className="mt-2 h-11"
          />
          {errors.name && (
            <p className="mt-1.5 text-xs text-red-400">{errors.name.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="demo-email" className="text-sm font-medium text-white">
            Email <span className="text-gold">*</span>
          </Label>
          <Input
            id="demo-email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className="mt-2 h-11"
          />
          {errors.email && (
            <p className="mt-1.5 text-xs text-red-400">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="demo-phone" className="text-sm font-medium text-white">
            Phone <span className="text-text-muted">(optional)</span>
          </Label>
          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <PhoneInput
                id="demo-phone"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={!!errors.phone}
                className="mt-2 h-11"
              />
            )}
          />
          {errors.phone && (
            <p className="mt-1.5 text-xs text-red-400">{errors.phone.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="demo-restaurant" className="text-sm font-medium text-white">
            Restaurant name <span className="text-text-muted">(optional)</span>
          </Label>
          <Input
            id="demo-restaurant"
            autoComplete="organization"
            {...register("restaurant_name")}
            className="mt-2 h-11"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="demo-message" className="text-sm font-medium text-white">
          Anything we should know? <span className="text-text-muted">(optional)</span>
        </Label>
        <Textarea
          id="demo-message"
          rows={4}
          maxLength={1000}
          placeholder="Tell us about your restaurant, what you're using today, or what you'd like to see."
          {...register("message")}
          className="mt-2"
        />
        <div className="mt-1.5 flex justify-end text-xs text-text-muted">
          {messageLen}/1000
        </div>
      </div>

      {submitError && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {submitError}
        </div>
      )}

      <Button
        type="submit"
        disabled={submitting}
        className="h-12 w-full rounded-md font-semibold sm:w-auto"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Send className="mr-2 size-4" />
            Send request
          </>
        )}
      </Button>

      <p className="text-xs text-text-muted">
        We'll reach out within one business day. No spam, ever.
      </p>
    </form>
  );
}
