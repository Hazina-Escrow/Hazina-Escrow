import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny } from 'zod';

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const flat = result.error.flatten();
      const fieldMessages = Object.values(flat.fieldErrors)
        .flat()
        .filter((m): m is string => typeof m === 'string' && m.length > 0);
      const formMessages = flat.formErrors.filter(m => m.length > 0);
      const allMessages = [...fieldMessages, ...formMessages];
      res.status(400).json({
        error: allMessages.length > 0 ? allMessages.join('; ') : 'Validation failed',
        fields: flat.fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
