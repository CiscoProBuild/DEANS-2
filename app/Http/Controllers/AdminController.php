<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AdminController extends Controller
{
    public function login(Request $request): JsonResponse|RedirectResponse
    {
        $username = trim((string) $request->input('username', ''));
        $password = (string) $request->input('password', '');
        $admin = DB::table('admin_users')->where('username', $username)->first();

        if (! $admin || ! $this->passwordMatches($admin->password, $password)) {
            if ($request->expectsJson()) {
                return response()->json(['error' => 'Invalid username or password.'], 401);
            }

            return back()->withErrors(['login' => 'Invalid username or password.']);
        }

        if (! Hash::isHashed($admin->password)) {
            DB::table('admin_users')->where('id', $admin->id)->update([
                'password' => Hash::make($password),
                'updated_at' => now()->toISOString(),
            ]);
        }

        $request->session()->regenerate();
        $request->session()->put([
            'adminLoggedIn' => true,
            'adminUsername' => $username,
        ]);

        return $request->expectsJson()
            ? response()->json(['username' => $username])
            : redirect('/admin');
    }

    public function logout(Request $request): JsonResponse
    {
        $request->session()->forget(['adminLoggedIn', 'adminUsername']);
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Signed out.']);
    }

    public function session(Request $request): JsonResponse
    {
        return response()->json([
            'authenticated' => (bool) $request->session()->get('adminLoggedIn', false),
        ]);
    }

    public function account(Request $request): JsonResponse
    {
        $admin = DB::table('admin_users')
            ->where('username', $request->session()->get('adminUsername', 'admin'))
            ->first(['username']);

        if (! $admin) {
            return response()->json(['error' => 'Admin account not found.'], 404);
        }

        return response()->json(['username' => $admin->username]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $values = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string'],
            'confirm_password' => ['required', 'string', 'same:new_password'],
        ], [
            'confirm_password.same' => 'New password and confirmation do not match.',
        ]);

        $username = $request->session()->get('adminUsername', 'admin');
        $admin = DB::table('admin_users')->where('username', $username)->first();

        if (! $admin || ! $this->passwordMatches($admin->password, $values['current_password'])) {
            return response()->json(['error' => 'Current password is incorrect.'], 400);
        }

        DB::table('admin_users')->where('id', $admin->id)->update([
            'password' => Hash::make($values['new_password']),
            'updated_at' => now()->toISOString(),
        ]);

        return response()->json([
            'message' => 'Password changed successfully.',
            'username' => $username,
        ]);
    }

    private function passwordMatches(string $stored, string $given): bool
    {
        return Hash::isHashed($stored)
            ? Hash::check($given, $stored)
            : hash_equals($stored, $given);
    }
}
