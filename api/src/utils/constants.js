const PATIENT_ROLE = 'patients';
const DOCTOR_ROLE = 'doctors';
const ADMIN_ROLE = 'admin@medjournal';

const COLLECTIONS = {
  USERS: 'users',
  DOCTORS: DOCTOR_ROLE,
  PATIENTS: PATIENT_ROLE,
  ADMINS: process.env.ADMIN_COLLECTION,
};
const VALID_ROLES = [PATIENT_ROLE, DOCTOR_ROLE];

const MESSAGES = {
  userRole: 'User Role is required',
  InvalidUserRole: 'Invalid selection of Role',
};

module.exports = {
  PATIENT_ROLE,
  DOCTOR_ROLE,
  VALID_ROLES,
  ADMIN_ROLE,
  COLLECTIONS,
  MESSAGES,
};
