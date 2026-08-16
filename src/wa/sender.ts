// Outbound-messaging port. Implemented by the Graph API client (prod),
// a rerouting wrapper (TEST_MODE), and fakes in tests/simulate.

export interface SendResult {
  ok: boolean;
  waMessageId?: string | null;
  /** set when the send was intentionally not performed ('dryrun' | 'window_closed') */
  skipped?: string;
  error?: string;
}

export interface ButtonSpec {
  id: string;
  title: string; // <= 20 chars
}

export interface Sender {
  text(toWaId: string, body: string): Promise<SendResult>;
  buttons(toWaId: string, body: string, buttons: ButtonSpec[]): Promise<SendResult>;
  template(toWaId: string, name: string, opts: { name?: string; buttonPayload?: string }): Promise<SendResult>;
  audio(toWaId: string, link: string, asVoice: boolean): Promise<SendResult>;
}
