-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL');

-- AlterTable
ALTER TABLE "Guard" ADD COLUMN     "email" TEXT,
ADD COLUMN     "watchNote" TEXT,
ADD COLUMN     "watched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "watchedAt" TIMESTAMP(3),
ADD COLUMN     "watchedById" TEXT;

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "channel" "MessageChannel" NOT NULL DEFAULT 'SMS',
ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Guard_watched_idx" ON "Guard"("watched");

-- CreateIndex
CREATE INDEX "SmsMessage_channel_idx" ON "SmsMessage"("channel");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
