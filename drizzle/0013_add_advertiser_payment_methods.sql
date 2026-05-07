CREATE TABLE "advertiser_payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_account_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"type" text NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"billing_name" text,
	"billing_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertiser_payment_methods" ADD CONSTRAINT "advertiser_payment_methods_advertiser_account_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_account_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertiser_payment_methods_account_idx" ON "advertiser_payment_methods" USING btree ("advertiser_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_payment_methods_stripe_pm_idx" ON "advertiser_payment_methods" USING btree ("stripe_payment_method_id");