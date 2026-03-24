import type { TFunction } from "i18next";
import { z } from "zod";

export function createLoginSchema(t: TFunction) {
  return z.object({
    email: z
      .string()
      .min(1, { message: t("auth.validation.required") })
      .email({ message: t("auth.validation.emailInvalid") }),
    password: z
      .string()
      .min(1, { message: t("auth.validation.required") })
      .min(8, { message: t("auth.validation.passwordMin") }),
  });
}

export function createRegisterSchema(t: TFunction) {
  return z
    .object({
      fullName: z.string().max(120, { message: t("auth.validation.fullNameMax") }),
      email: z
        .string()
        .min(1, { message: t("auth.validation.required") })
        .email({ message: t("auth.validation.emailInvalid") }),
      password: z
        .string()
        .min(1, { message: t("auth.validation.required") })
        .min(8, { message: t("auth.validation.passwordMin") }),
      confirmPassword: z.string().min(1, { message: t("auth.validation.required") }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("auth.validation.passwordMismatch"),
      path: ["confirmPassword"],
    });
}

export function createForgotPasswordSchema(t: TFunction) {
  return z.object({
    email: z
      .string()
      .min(1, { message: t("auth.validation.required") })
      .email({ message: t("auth.validation.emailInvalid") }),
  });
}

export function createResetPasswordSchema(t: TFunction) {
  return z
    .object({
      password: z
        .string()
        .min(1, { message: t("auth.validation.required") })
        .min(8, { message: t("auth.validation.passwordMin") }),
      confirmPassword: z.string().min(1, { message: t("auth.validation.required") }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("auth.validation.passwordMismatch"),
      path: ["confirmPassword"],
    });
}
