CREATE TABLE "ApplicantPerson" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicantPerson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicantPerson_applicationId_idx" ON "ApplicantPerson"("applicationId");
CREATE INDEX "ApplicantPerson_phone_idx" ON "ApplicantPerson"("phone");

ALTER TABLE "ApplicantPerson"
ADD CONSTRAINT "ApplicantPerson_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
