import { Request, Response, NextFunction } from "express";
import prisma from "../prisma";

interface Booking {
  guestName: string;
  unitID: string;
  checkInDate: Date;
  numberOfNights: number;
}

const healthCheck = async (req: Request, res: Response, next: NextFunction) => {
  return res.status(200).json({ message: "OK" });
};

const createBooking = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const booking: Booking = req.body;

  let outcome = await isBookingPossible(booking);
  if (!outcome.result) {
    return res.status(400).json(outcome.reason);
  }

  let bookingResult = await prisma.booking.create({
    data: {
      guestName: booking.guestName,
      unitID: booking.unitID,
      checkInDate: new Date(booking.checkInDate),
      numberOfNights: booking.numberOfNights,
    },
  });

  return res.status(200).json(bookingResult);
};

const extendBooking = async (req: Request, res: Response) => {
  const bookingId = parseInt(req.params.id, 10);
  const extraNights = Number(req.body.extraNights);

  // validate input
  if (!extraNights || extraNights <= 0) {
    return res
      .status(400)
      .json({ message: "Extra nights should be a valid number" });
  }

  // find booking
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

  // calculate current and proposed checkout
  const checkIn = new Date(booking.checkInDate);
  const currentCheckout = new Date(checkIn);
  currentCheckout.setDate(checkIn.getDate() + booking.numberOfNights);

  const proposedCheckout = new Date(currentCheckout);
  proposedCheckout.setDate(currentCheckout.getDate() + extraNights);

  // check if the unit is free in the extension window
  const conflictingBookings = await prisma.booking.findMany({
    where: {
      unitID: booking.unitID,
      id: { not: booking.id },
      checkInDate: { lt: proposedCheckout },
    },
  });

  for (const other of conflictingBookings) {
    const otherCheckIn = new Date(other.checkInDate);
    const otherCheckOut = new Date(otherCheckIn);
    otherCheckOut.setDate(otherCheckIn.getDate() + other.numberOfNights);

    if (currentCheckout < otherCheckOut && otherCheckIn < proposedCheckout) {
      return res
        .status(409)
        .json({
          message: "Extension not possible; unit is taken in that period",
        });
    }
  }

  // update the booking
  const updatedBooking = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      numberOfNights: booking.numberOfNights + extraNights,
    },
  });

  return res.status(200).json(updatedBooking);
};

function addNights(date: Date, nights: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + nights);
  return d;
}

type BookingOutcome = { result: boolean; reason: any };

async function isBookingPossible(booking: Booking): Promise<BookingOutcome> {
  // check 1 : The Same guest cannot book the same unit multiple times
  const sameGuestSameUnit = await prisma.booking.findMany({
    where: {
      AND: {
        guestName: { equals: booking.guestName },
        unitID: { equals: booking.unitID },
      },
    },
  });
  if (sameGuestSameUnit.length > 0) {
    return {
      result: false,
      reason: "The given guest name cannot book the same unit multiple times",
    };
  }

  // check 2 : the same guest cannot be in multiple units at the same time
  const sameGuestAlreadyBooked = await prisma.booking.findMany({
    where: { guestName: { equals: booking.guestName } },
  });
  if (sameGuestAlreadyBooked.length > 0) {
    return {
      result: false,
      reason: "The same guest cannot be in multiple units at the same time",
    };
  }

  // check 3 : Unit is available for the *exact* check-in date
  const isUnitAvailableOnCheckInDate = await prisma.booking.findMany({
    where: {
      AND: {
        checkInDate: { equals: new Date(booking.checkInDate) },
        unitID: { equals: booking.unitID },
      },
    },
  });
  if (isUnitAvailableOnCheckInDate.length > 0) {
    //unit is already booked on the check-in date
    return {
      result: false,
      reason: "For the given check-in date, the unit is already occupied",
    };
  }

  // Treat bookings as (checkIn, checkOut)
  const newCheckIn = new Date(booking.checkInDate);
  const newCheckOut = addNights(newCheckIn, booking.numberOfNights);

  const unitCandidates = await prisma.booking.findMany({
    where: {
      unitID: booking.unitID,
      checkInDate: { lt: newCheckOut },
    },
  });

  for (const b of unitCandidates) {
    const bCheckIn = new Date(b.checkInDate);
    const bCheckOut = addNights(bCheckIn, b.numberOfNights);
    const overlaps = newCheckIn < bCheckOut && bCheckIn < newCheckOut;
    if (overlaps) {
      // For the "different date" overlap, cannot book it
      return {
        result: false,
        reason: "For the given check-in date, the unit is already occupied",
      };
    }
  }

  return { result: true, reason: "OK" };
}

export default { healthCheck, createBooking, extendBooking };
