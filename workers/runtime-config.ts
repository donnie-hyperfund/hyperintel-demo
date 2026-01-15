/**
 * Runtime configuration for _common helpers.
 * This file is project-specific and imported by _common via relative path.
 */
export const common_db = 'neon' as const;
export const common_auth = 'clerk' as const;

// Supabase projects: export type { Database as SupabaseDatabase } from '@/lib/api/database/types';
export type SupabaseDatabase = any;

// Project-specific user type
// Supabase projects: export type { User as AppUser } from '@/lib/api/schemas/user.schema';
import type { ClerkUser } from './_common/vendor/clerk';
export type AppUser = ClerkUser;
//  might need to do AppUser = SupaUser | User
// import { SupabaseClient, User as SupaUser } from '@supabase/supabase-js';

// Clerk user type - this project uses Clerk
export type { ClerkUser } from './_common/vendor/clerk';
// Non-Clerk projects: export type ClerkUser = any;
