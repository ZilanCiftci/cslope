/**
 * Equilibrium at one strength reduction factor by the constant stiffness
 * method with implicit stress return, accelerated by BFGS updates.
 *
 * Method and sources:
 * - Constant (elastic) stiffness iteration with an implicit return of the
 *   stresses to the yield surface at every iteration: the modified initial
 *   strain method of Vermeer (1979, Proc. 3rd Int. Conf. Num. Meth.
 *   Geomech., 377–387). For associated plasticity it converges also for
 *   large load increments (Vermeer & van Langen 1989, Ingenieur-Archiv 59,
 *   221–236), so that a trial that does not converge is beyond collapse.
 *   The elastic stiffness is factorised once per mesh (model.K).
 * - Acceleration: BFGS quasi-Newton updates of the inverse stiffness, with
 *   the elastic stiffness as the initial matrix (Matthies & Strang 1979,
 *   IJNME 14(11), 1613–1626), applied by the two-loop recursion of the
 *   limited-memory form (Nocedal 1980, Math. Comput. 35(151), 773–782),
 *   and the initial matrix scaled by γ = sᵀy / yᵀK⁻¹y at every iteration
 *   (Nocedal & Wright 2006, eq. 7.20, in the elastic energy norm).
 *   Pairs whose curvature sᵀy is not positive are skipped, which keeps the
 *   update positive definite (Nocedal & Wright, Numerical Optimization,
 *   2nd ed., 2006, ch. 6).
 * - Line search on the energy, as Matthies & Strang (1979): along the
 *   direction d the residual component g(α) = dᵀr(u + αd) is brought to
 *   at most half of g(0) by secant steps (STOL = 0.5).
 * - The stress return is the closest-point return of newton.ts (Clausen,
 *   Damkilde & Andersen 2006).
 *
 * Implementation choices (not from the literature): convergence at a
 * residual of `tolerance` (default 10⁻⁴) of the load; 50 stored pairs; at
 * most 2000 iterations; failure when the residual has not fallen by 10 %
 * over 200 iterations; at most 8 line search steps and a step of at most 8.
 * Near collapse the iterations grow steeply (V056: 654 at F = 0.50, 1495 at
 * 0.51, against Newton's 21), so the solver is an option, not the default.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly: a kernel of the trials, not exported (tested in Rust).
 */

export interface BfgsOptions {
  /** Relative residual tolerance ‖r‖/‖f‖; default 1e-4. */
  tolerance?: number;
  /** Iterations per trial; default 2000. */
  maxIterations?: number;
  tensionCutoff?: boolean;
}
