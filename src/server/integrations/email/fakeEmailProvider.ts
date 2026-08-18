import { assertSafeTestEnvelope } from "../../../domain/send/testSendPolicy";
import type {
  EmailProvider,
  ProviderConfigStatus,
  ProviderSendResult,
  TestEmailMessage,
} from "./emailProvider";

/**
 * In-memory provider used by tests.
 *
 * It applies the SAME envelope guard as the real adapter, so a test that proves "no
 * unauthorized address reaches the provider" is proving the guard, not the fake.
 * It performs no network I/O and can never send an email.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly name = "FAKE" as const;

  /** Every message that reached the provider — the assertion surface for tests. */
  readonly sent: TestEmailMessage[] = [];

  constructor(
    private readonly behaviour: {
      configured?: boolean;
      problems?: string[];
      result?: ProviderSendResult;
      /** Optional hook to simulate slow/concurrent submissions. */
      onSend?: () => Promise<void>;
    } = {},
  ) {}

  get callCount(): number {
    return this.sent.length;
  }

  checkConfiguration(): ProviderConfigStatus {
    const configured = this.behaviour.configured ?? true;
    return {
      configured,
      problems: configured ? [] : (this.behaviour.problems ?? ["Fake provider is not configured."]),
      senderEmail: "axisgpscana@gmail.com",
    };
  }

  async sendTestEmail(message: TestEmailMessage): Promise<ProviderSendResult> {
    // Same guard as the real adapter — throws before anything is recorded.
    assertSafeTestEnvelope({ to: message.to });

    if (this.behaviour.onSend) await this.behaviour.onSend();

    this.sent.push(message);

    return (
      this.behaviour.result ?? {
        outcome: "ACCEPTED",
        statusCode: 250,
        providerMessageId: `fake-${this.sent.length}`,
        message: "Gmail accepted the test email for delivery.",
      }
    );
  }
}
