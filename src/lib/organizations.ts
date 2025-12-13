import { cancel, isCancel, select } from "@clack/prompts";
import type { Organization } from "better-auth/plugins/organization";
import chalk from "chalk";
import { authClient, SERVER_URL } from "./auth.js";

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

  return selectedOrg;
}
