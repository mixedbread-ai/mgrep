import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cancel, isCancel, select } from "@clack/prompts";
import type { Organization } from "better-auth/plugins/organization";
import chalk from "chalk";
import { authClient, SERVER_URL } from "./auth.js";

const CONFIG_DIR = path.join(os.homedir(), ".mgrep");
const ORG_CACHE_FILE = path.join(CONFIG_DIR, "organization.json");

interface CachedOrganization {
  id: string;
  name: string;
  slug: string;
  cached_at: string;
}

/**
 * Gets the current organization from the server session
 */
export async function getCurrentOrganization(accessToken: string) {
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  return session?.session?.activeOrganizationId
    ? { id: session.session.activeOrganizationId }
    : null;
}

/**
 * Caches organization info locally for display purposes
 */
export async function cacheOrganization(org: Organization): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const cacheData: CachedOrganization = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      cached_at: new Date().toISOString(),
    };
    await fs.writeFile(ORG_CACHE_FILE, JSON.stringify(cacheData, null, 2));
  } catch {
    // Silently fail - caching is optional
  }
}

/**
 * Gets cached organization info for display (does not require network)
 */
export async function getCachedOrganization(): Promise<CachedOrganization | null> {
  try {
    const data = await fs.readFile(ORG_CACHE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Clears the cached organization info
 */
export async function clearCachedOrganization(): Promise<void> {
  try {
    await fs.unlink(ORG_CACHE_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function listOrganizations(accessToken: string) {
  const response = await fetch(`${SERVER_URL}/api/auth/organization/list`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const organizations: Array<Organization> = await response.json();

  return organizations;
}

export async function selectOrganization(
  accessToken: string,
  currentOrgId?: string | null,
) {
  const organizations = await listOrganizations(accessToken);

  let selectedOrg: Organization;

  if (organizations.length === 0) {
    console.error("No organizations found for this account.");
    process.exit(1);
  } else if (organizations.length === 1) {
    selectedOrg = organizations[0];
  } else {
    const selectedOrgId = await select({
      message: "Select an organization",
      options: organizations.map((org) => ({
        value: org.id,
        label:
          org.id === currentOrgId
            ? `${org.name} (${org.slug}) ${chalk.dim("(current)")}`
            : `${org.name} (${org.slug})`,
      })),
    });

    if (isCancel(selectedOrgId)) {
      cancel("Selecting organization cancelled");
      process.exit(0);
    }

    // biome-ignore lint/style/noNonNullAssertion: -
    selectedOrg = organizations.find((org) => org.id === selectedOrgId)!;
  }

  const response = await authClient.organization.setActive(
    { organizationId: selectedOrg.id },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.error) {
    console.error(`Failed to select organization: ${response.error.message}`);
    process.exit(1);
  }

  // Cache the selected organization for display purposes
  await cacheOrganization(selectedOrg);

  return selectedOrg;
}

/**
 * Gets organization info by ID from the user's organization list
 */
export async function getOrganizationById(
  accessToken: string,
  orgId: string,
): Promise<Organization | null> {
  const organizations = await listOrganizations(accessToken);
  return organizations.find((org) => org.id === orgId) ?? null;
}

/**
 * Gets the full current organization info (with name and slug)
 * Falls back to cached info if available
 */
export async function getCurrentOrganizationInfo(
  accessToken: string,
): Promise<CachedOrganization | null> {
  const current = await getCurrentOrganization(accessToken);
  if (!current) {
    return null;
  }

  // Try to get full org info from server
  const org = await getOrganizationById(accessToken, current.id);
  if (org) {
    // Update cache with fresh info
    await cacheOrganization(org);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      cached_at: new Date().toISOString(),
    };
  }

  // Fall back to cached info
  return getCachedOrganization();
}
