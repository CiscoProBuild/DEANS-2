<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireAdminSession
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! (bool) $request->session()->get('adminLoggedIn', false)) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return response()->json(['error' => 'Admin authentication required.'], 401);
            }

            return redirect('/login');
        }

        return $next($request);
    }
}
