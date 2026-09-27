import type { Metadata } from 'next';
import { RecoveryForm } from '@/components/auth/recovery-form';

export const metadata: Metadata = { title: 'Forgot password · Kedge' };
export default function ForgotPasswordPage() { return <RecoveryForm mode="forgot" />; }
