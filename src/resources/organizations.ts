import {
  organizationControllerCreateInvitation,
  organizationControllerCreateOrganization,
  organizationControllerDeleteOrganization,
  organizationControllerEditOrganization,
  organizationControllerGetAllOrganizations,
  organizationControllerGetOrganization,
  organizationControllerRemoveMember,
  organizationControllerTransferOwnership,
} from "../_internal/api/sdk.gen.js";
import type {
  CreateInvitationDto,
  CreateOrganizationDto,
  InvitationResponseDto,
  OkResponseDto,
  OrganizationCreateResponseDto,
  SuccessResponseDto,
} from "../_internal/api/types.gen.js";
import type { Organization } from "../models.js";
import type { ResourceClient } from "./_client.js";

/** Mutable organization fields accepted by {@link OrganizationsResource.update}. */
export interface OrganizationUpdateFields {
  name?: string;
  slug?: string;
  description?: string;
}

export type InvitationRole = CreateInvitationDto["desired_role"];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Manage organizations, invitations, and ownership transfers. */
export class OrganizationsResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * Create a new organization. The slug is derived from the name when omitted.
   *
   * @param name - Human-readable organization name.
   * @returns The created organization (with bootstrap tokens), or `null` on fail-open error.
   */
  async create(name: string): Promise<OrganizationCreateResponseDto | null> {
    const body: CreateOrganizationDto = { name, slug: slugify(name) };
    return this.client.invoke(organizationControllerCreateOrganization, { body });
  }

  /**
   * Fetch an organization by UUID.
   *
   * @param id - Organization UUID.
   * @returns The organization, or `null` on fail-open error.
   */
  async get(id: string): Promise<Organization | null> {
    return this.client.invoke(organizationControllerGetOrganization, { path: { id } });
  }

  /**
   * List organizations the caller is a member of.
   *
   * @returns Organizations, or `null` on fail-open error.
   */
  async list(): Promise<Organization[] | null> {
    return this.client.invoke(organizationControllerGetAllOrganizations, {});
  }

  /**
   * Update mutable organization fields. The backend currently expects a full
   * `CreateOrganizationDto`; missing fields are filled with stable placeholders
   * derived from the patch.
   *
   * @param id - Organization UUID.
   * @param fields - Patch object.
   * @returns Server ack, or `null` on fail-open error.
   */
  async update(id: string, fields: OrganizationUpdateFields): Promise<OkResponseDto | null> {
    const body: CreateOrganizationDto = {
      name: fields.name ?? "",
      slug: fields.slug ?? (fields.name ? slugify(fields.name) : ""),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
    };
    return this.client.invoke(organizationControllerEditOrganization, {
      path: { id },
      body,
    });
  }

  /**
   * Delete an organization.
   *
   * @param id - Organization UUID.
   * @returns Server ack, or `null` on fail-open error.
   */
  async delete(id: string): Promise<OkResponseDto | null> {
    return this.client.invoke(organizationControllerDeleteOrganization, { path: { id } });
  }

  /**
   * Invite a user to an organization.
   *
   * @param orgId - Organization UUID.
   * @param email - Invitee email.
   * @param role - Invitation role; defaults to `"user"`.
   * @returns The created invitation, or `null` on fail-open error.
   */
  async invite(
    orgId: string,
    email: string,
    role: InvitationRole = "user",
  ): Promise<InvitationResponseDto | null> {
    return this.client.invoke(organizationControllerCreateInvitation, {
      path: { id: orgId },
      body: { invitedEmail: email, desired_role: role },
    });
  }

  /**
   * Remove a member from an organization.
   *
   * @param orgId - Organization UUID.
   * @param userId - User UUID to remove.
   * @returns Success ack, or `null` on fail-open error.
   */
  async removeMember(orgId: string, userId: string): Promise<SuccessResponseDto | null> {
    return this.client.invoke(organizationControllerRemoveMember, {
      path: { id: orgId, userId },
    });
  }

  /**
   * Transfer ownership of an organization to another member.
   *
   * @param orgId - Organization UUID.
   * @param targetUserId - User UUID to promote.
   * @returns Success ack, or `null` on fail-open error.
   */
  async transferOwnership(orgId: string, targetUserId: string): Promise<SuccessResponseDto | null> {
    return this.client.invoke(organizationControllerTransferOwnership, {
      path: { id: orgId },
      body: { userId: targetUserId },
    }) as Promise<SuccessResponseDto | null>;
  }
}
