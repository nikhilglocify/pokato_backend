-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "stripeAccountId" TEXT,
    "stripeAccountStatus" TEXT DEFAULT 'not_connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_details" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "stripeAccountStatus" TEXT NOT NULL DEFAULT 'not_connected',
    "stripePublishableKey" TEXT,
    "stripeAccessToken" TEXT NOT NULL,
    "stripeRefreshToken" TEXT NOT NULL,
    "stripeScope" TEXT NOT NULL,
    "stripeTokenType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeAccountId_key" ON "users"("stripeAccountId");

-- CreateIndex
CREATE INDEX "users_stripeAccountId_idx" ON "users"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_details_userId_key" ON "stripe_details"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_details_stripeAccountId_key" ON "stripe_details"("stripeAccountId");

-- CreateIndex
CREATE INDEX "stripe_details_stripeAccountId_idx" ON "stripe_details"("stripeAccountId");

-- AddForeignKey
ALTER TABLE "stripe_details" ADD CONSTRAINT "stripe_details_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

