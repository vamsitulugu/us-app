-- ⚠ DELETES DATA. Run only after you are sure you do not need the old manual
-- UPI / screenshot payment requests. Real payments live in pro_payments (Razorpay)
-- and are NOT touched. Back up first:  select * from pro_upgrade_requests;
drop table if exists pro_upgrade_requests;
