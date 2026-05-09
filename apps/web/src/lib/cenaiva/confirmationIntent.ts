function normalizeConfirmationText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCenaivaAffirmativeBookingConfirmation(transcript: string): boolean {
  const text = normalizeConfirmationText(transcript);
  if (!text) return false;

  return (
    /^(yes|yeah|yep|yup|sure|ok|okay|alright|fine|please|yes please|yeah please|sounds good|go ahead|book it|do it|confirm|confirmed|let's do it|lock it in|make it|make the reservation|please do)$/.test(
      text,
    ) ||
    /\b(yes|confirm|confirmed|book it|go ahead|do it|lock it in|make the reservation|please do)\b/.test(
      text,
    )
  );
}

export function isCenaivaNegativeBookingConfirmation(transcript: string): boolean {
  const text = normalizeConfirmationText(transcript);
  if (!text) return false;

  return (
    /^(no|nope|nah|not yet|wait|hold on|cancel|stop|don't|do not|different|change it|change that)$/.test(
      text,
    ) || /\b(no|nope|nah|not yet|wait|hold on|cancel|stop|different|change)\b/.test(text)
  );
}

export function isCenaivaBookingConfirmationReply(transcript: string): boolean {
  return (
    isCenaivaAffirmativeBookingConfirmation(transcript) ||
    isCenaivaNegativeBookingConfirmation(transcript)
  );
}

export function shouldRouteAsCenaivaBookingConfirmation(
  bookingStatus: string | null | undefined,
  transcript: string,
): boolean {
  return bookingStatus === "confirming" && isCenaivaBookingConfirmationReply(transcript);
}

export function transcriptForCenaivaBookingConfirmation(
  bookingStatus: string | null | undefined,
  transcript: string,
): string {
  if (
    bookingStatus === "confirming" &&
    isCenaivaAffirmativeBookingConfirmation(transcript)
  ) {
    return "yes, confirm booking";
  }
  return transcript;
}
